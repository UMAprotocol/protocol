import { Datastore } from "@google-cloud/datastore";
import retry, { Options as RetryOptions } from "async-retry";
import fs from "fs";
import { request } from "graphql-request";
import { gql } from "graphql-tag";
import path from "path";

import { ForkedTenderlyResult, generateForkedSimulation, Logger, MonitoringParams } from "./common";
import { logSnapshotProposal } from "./MonitorLogger";
import {
  GraphqlData,
  isMatchingSafe,
  isSnapshotProposalGraphql,
  SnapshotProposalGraphql,
  translateToSafeSnap,
} from "./SnapshotVerification";

let datastoreInstance: Datastore | undefined; // Only used when state is stored in Google Datastore.

// Returns a singleton instance of Google Datastore.
const getDatastoreInstance = () => {
  if (!datastoreInstance) {
    datastoreInstance = new Datastore();
  }
  return datastoreInstance;
};

const filePath = `${path.resolve(__dirname)}/notifiedSnapshotProposals.json`; // Only used when state is stored in local file.

// Queries Snapshot for all proposals that are still active and have the required plugin.
// This uses provided retry config, but ultimately throws the error if the Snapshot query fails after all retries.
// This also validates returned data and filters only proposals that use either safeSnap or oSnap plugin.
const getActivePluginProposals = async (
  plugin: string,
  url: string,
  retryOptions: RetryOptions
): Promise<Array<SnapshotProposalGraphql>> => {
  const query = gql(/* GraphQL */ `
    query GetActiveProposals($plugin: String) {
      proposals(
        first: 1000 # Maximum number that can be returned by Snapshot (should be enough for active plugin proposals).
        where: { plugins_contains: $plugin, state: "active" }
        orderBy: "created"
        orderDirection: desc
      ) {
        id
        ipfs
        type
        choices
        start
        end
        state
        space {
          id
        }
        scores
        quorum
        scores_total
        plugins
      }
    }
  `);

  const graphqlData = await retry(
    () => request<GraphqlData, { plugin: string }>(url, query, { plugin }),
    retryOptions
  );
  // Filter only for proposals that have a properly configured safeSnap or oSnap plugin.
  return graphqlData.proposals.filter(isSnapshotProposalGraphql);
};

// Get all active safeSnap/oSnap proposals from all spaces targeting monitored safes (returned in safeSnap format).
const getActiveSnapshotProposals = async (
  logger: typeof Logger,
  params: MonitoringParams
): Promise<Array<SnapshotProposalGraphql>> => {
  // Get all active safeSnap/oSnap proposals from all spaces (including rejected promises that we will handle below).
  const allProposals = await Promise.allSettled(
    ["oSnap", "safeSnap"].map(async (plugin) =>
      getActivePluginProposals(plugin, params.graphqlEndpoint, params.retryOptions)
    )
  );

  // Log any errors that occurred when fetching Snapshot proposals and filter them out.
  const nonErrorProposals: SnapshotProposalGraphql[] = [];
  for (const proposal of allProposals) {
    if (proposal.status === "fulfilled") {
      nonErrorProposals.push(...proposal.value);
    } else {
      logger.error({
        at: "oSnapMonitor",
        message: "Server error when fetching Snapshot proposals 🤖",
        mrkdwn: "Failed to fetch Snapshot proposals",
        error: proposal.reason,
        notificationPath: "optimistic-governor",
      });
    }
  }

  // Filter out proposals that do not target any of the monitored safes.
  return nonErrorProposals.filter((proposal) => {
    return params.ogAddresses.some((ogAddress) => {
      const safeSnapPlugin = translateToSafeSnap(proposal.plugins);
      return safeSnapPlugin.safeSnap.safes.some((safe) => isMatchingSafe(safe, params.chainId, ogAddress));
    });
  });
};

// Returns all notified proposals from saved state (Google Datastore or local file).
const getNotifiedProposals = async (params: MonitoringParams): Promise<string[]> => {
  if (params.storage === "datastore") {
    const datastore = getDatastoreInstance();
    const query = datastore.createQuery("NotifiedSnapshotProposals");
    const [notifiedProposals] = await datastore.runQuery(query);
    return notifiedProposals.map((proposal) => proposal.id);
  } else {
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  }
};

// Adds notified proposals to saved state (Google Datastore or local file).
const updateNotifiedProposals = async (proposalId: string, params: MonitoringParams) => {
  if (params.storage === "datastore") {
    const datastore = getDatastoreInstance();
    const key = datastore.key(["NotifiedSnapshotProposals", proposalId]);
    const data = { id: proposalId };
    await datastore.save({ key, data });
  } else {
    const notifiedProposals = await getNotifiedProposals(params);
    if (!notifiedProposals.includes(proposalId)) {
      notifiedProposals.push(proposalId);
      fs.writeFileSync(filePath, JSON.stringify(notifiedProposals, null, 2), "utf-8");
    }
  }
};

// Tries to run simulations for all safes in the proposal. If this fails or simulation is not enabled, it will be skipped.
const tryProposalSimulations = async (
  logger: typeof Logger,
  proposal: SnapshotProposalGraphql,
  params: MonitoringParams
): Promise<ForkedTenderlyResult[]> => {
  if (!params.useTenderly) return []; // Simulation is not enabled.

  // safeSnap plugin proposal might target multiple safes, so we will expand it and run a simulation for each safe.
  const safeSnapPlugin = translateToSafeSnap(proposal.plugins);
  const simulationResults: ForkedTenderlyResult[] = [];
  const expandedProposals = safeSnapPlugin.safeSnap.safes.map((safe) => {
    const { plugins, ...clonedObject } = proposal;
    return { ...clonedObject, safe };
  });
  for (const expandedProposal of expandedProposals) {
    try {
      const simulationResult = await generateForkedSimulation(expandedProposal, params.retryOptions);
      simulationResults.push(simulationResult);
    } catch (error) {
      // Simulation failed to generate, so we will skip this safe and debug the issue.
      logger.debug({
        at: "oSnapMonitor",
        message: "Failed to generate forked Tenderly simulation 🤷‍♀️",
        mrkdwn:
          "Failed to generate Tenderly simulation for " +
          expandedProposal.space.id +
          " proposal " +
          expandedProposal.id +
          " targeting oSnap module " +
          expandedProposal.safe.umaAddress +
          " on chainId " +
          expandedProposal.safe.network,
        error,
        notificationPath: "optimistic-governor",
      });
    }
  }
  return simulationResults;
};

// Logs all new proposals that have not been notified yet.
export const notifyNewProposals = async (logger: typeof Logger, params: MonitoringParams): Promise<void> => {
  const snapshotProposals = await getActiveSnapshotProposals(logger, params);
  const notifiedProposals = await getNotifiedProposals(params);

  // Filter out proposals that have already been notified. Since oSnap modules on different chains might reference the
  // same space, it is still possible to have duplicate notifications from bot instances that are running in parallel.
  const newProposals = snapshotProposals.filter((proposal) => !notifiedProposals.includes(proposal.id));

  for (const proposal of newProposals) {
    const simulationResults = await tryProposalSimulations(logger, proposal, params);
    logSnapshotProposal(logger, proposal, params, simulationResults);
    await updateNotifiedProposals(proposal.id, params);
  }
};
