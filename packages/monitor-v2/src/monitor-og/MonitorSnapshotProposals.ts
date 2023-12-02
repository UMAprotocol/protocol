import { Datastore } from "@google-cloud/datastore";
import assert from "assert";
import retry, { Options as RetryOptions } from "async-retry";
import { promises as fsPromises } from "fs";
import { request } from "graphql-request";
import { gql } from "graphql-tag";

import { getOgByAddress, Logger, MonitoringParams } from "./common";
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

// Returns null if the rules string does not contain Snapshot space url.
const parseSpaceFromRules = (rules: string, params: MonitoringParams): string | null => {
  // Will match the first Snapshot space url in the rules string.
  const regexPattern = `${params.snapshotEndpoint.replace(".", "\\.")}/#\\/([a-zA-Z0-9-.]+)\\/?`;
  const regex = new RegExp(regexPattern);

  const match = rules.match(regex);
  if (!match) return null;

  return match[1];
};

// Filters through all monitored OGs and returns all Snapshot spaces their rules are pointing at.
const getMonitoredSpaces = async (params: MonitoringParams): Promise<string[]> => {
  const monitoredSpaces = new Set<string>();

  await Promise.all(
    params.ogAddresses.map(async (ogAddress) => {
      const og = await getOgByAddress(params, ogAddress);
      const rules = await og.rules();
      const parsedSpace = parseSpaceFromRules(rules, params);
      if (parsedSpace !== null) monitoredSpaces.add(parsedSpace);
    })
  );

  return Array.from(monitoredSpaces);
};

// Queries Snapshot for all space proposals that are still active and are of basic type that oSnap supports.
// This uses provided retry config, but ultimately returns the error object if the Snapshot query fails after all
// retries. This also validates returned data and filters only proposals that use either safeSnap or oSnap plugin.
const getActiveSpaceProposals = async (
  spaceId: string,
  url: string,
  retryOptions: RetryOptions
): Promise<Array<SnapshotProposalGraphql> | Error> => {
  const query = gql(/* GraphQL */ `
    query GetActiveProposals($spaceId: String) {
      proposals(where: { space: $spaceId, type: "basic", state: "active" }, orderBy: "created", orderDirection: desc) {
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

  // If the GraphQL request fails for any reason, we return an Error object that will be logged by the bot.
  try {
    const graphqlData = await retry(
      () => request<GraphqlData, { spaceId: string }>(url, query, { spaceId }),
      retryOptions
    );
    // Filter only for proposals that have a properly configured safeSnap or oSnap plugin.
    return graphqlData.proposals.filter(isSnapshotProposalGraphql);
  } catch (error) {
    assert(error instanceof Error, "Unexpected Error type!");
    return error;
  }
};

// Get all active basic safeSnap/oSnap proposals for monitored spaces and safes (returned in safeSnap format).
const getActiveSnapshotProposals = async (
  logger: typeof Logger,
  params: MonitoringParams
): Promise<Array<SnapshotProposalGraphql>> => {
  // Get all spaces from monitored OGs.
  const monitoredSpaces = await getMonitoredSpaces(params);

  // Get all active basic safeSnap/oSnap proposals for monitored spaces.
  const snapshotProposals = (
    await Promise.all(
      monitoredSpaces.map(async (space) => getActiveSpaceProposals(space, params.graphqlEndpoint, params.retryOptions))
    )
  ).flat();

  // Log all errors that occurred when fetching Snapshot proposals and filter them out.
  const nonErrorProposals = snapshotProposals.filter((proposal) => {
    if (!(proposal instanceof Error)) return true;
    logger.error({
      at: "oSnapAutomation",
      message: "Server error when fetching Snapshot proposals",
      mrkdwn: "Failed to fetch Snapshot proposals",
      error: proposal,
      notificationPath: "optimistic-governor",
    });
    return false;
  }) as SnapshotProposalGraphql[];

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
    let notifiedProposalsStringified: string;
    try {
      const filePath = "./notifiedSnapshotProposals.json";
      notifiedProposalsStringified = await fsPromises.readFile(filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return JSON.parse(notifiedProposalsStringified);
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
    const filePath = "./notifiedSnapshotProposals.json";
    if (!notifiedProposals.includes(proposalId)) {
      notifiedProposals.push(proposalId);
      await fsPromises.writeFile(filePath, JSON.stringify(notifiedProposals, null, 2), "utf-8");
    }
  }
};

// Logs all new proposals that have not been notified yet.
export const notifyNewProposals = async (logger: typeof Logger, params: MonitoringParams): Promise<void> => {
  const snapshotProposals = await getActiveSnapshotProposals(logger, params);
  const notifiedProposals = await getNotifiedProposals(params);

  // Filter out proposals that have already been notified.
  const newProposals = snapshotProposals.filter((proposal) => !notifiedProposals.includes(proposal.id));

  for (const proposal of newProposals) {
    logSnapshotProposal(logger, proposal, params);
    await updateNotifiedProposals(proposal.id, params);
  }
};
