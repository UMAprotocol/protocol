import {
  ProposalDeletedEvent,
  TransactionsProposedEvent,
} from "@uma/contracts-node/typechain/core/ethers/OptimisticGovernor";
import assert from "assert";
import retry, { Options as RetryOptions } from "async-retry";
import { utils as ethersUtils } from "ethers";
import { request } from "graphql-request";
import { gql } from "graphql-tag";

import { getOgByAddress, Logger, MonitoringParams, runQueryFilter, SupportedBonds } from "./common";
import {
  GraphqlData,
  isMatchingSafe,
  parseRules,
  RulesParameters,
  SafeSnapSafe,
  SnapshotProposalGraphql,
} from "./SnapshotVerification";

interface SupportedParameters {
  parsedRules: RulesParameters;
  currency: string;
  bond: string;
}

interface SupportedModules {
  [ogAddress: string]: SupportedParameters;
}

// Checks that currency is among supportedBonds and that the bond amount exactly matches.
const isBondSupported = (currency: string, bond: string, supportedBonds?: SupportedBonds): boolean => {
  for (const supportedCurrency in supportedBonds) {
    if (ethersUtils.getAddress(currency) === ethersUtils.getAddress(supportedCurrency)) {
      return supportedBonds[supportedCurrency] === bond;
    }
  }
  return false;
};

// Filters through all monitored OGs and returns all supported modules with their parameters. Specifically, this checks
// that standard parsable rules are present and that the bond currency and amount is supported.
const getSupportedModules = async (params: MonitoringParams): Promise<SupportedModules> => {
  const supportedModules: SupportedModules = {};

  await Promise.all(
    params.ogAddresses.map(async (ogAddress) => {
      const og = await getOgByAddress(params, ogAddress);
      const rules = await og.rules();
      const parsedRules = parseRules(rules);
      const currency = await og.collateral();
      const bond = (await og.bondAmount()).toString();
      if (parsedRules !== null && isBondSupported(currency, bond, params.supportedBonds))
        supportedModules[ogAddress] = { parsedRules, currency, bond };
    })
  );

  return supportedModules;
};

// Queries snapshot for all space proposals that have been closed and have a plugin of safeSnap. The query also filters
// only for basic type proposals that oSnap automation supports. This uses provided retry config, but ultimately throws
// if the Snapshot query fails after all retries.
const getSnapshotProposals = async (
  spaceId: string,
  url: string,
  retryOptions: RetryOptions
): Promise<Array<SnapshotProposalGraphql>> => {
  const query = gql(/* GraphQL */ `
    query GetProposals($spaceId: String) {
      proposals(
        where: { space: $spaceId, type: "basic", plugins_contains: "safeSnap", scores_state: "final", state: "closed" }
        orderBy: "created"
        orderDirection: desc
      ) {
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
    () => request<GraphqlData, { spaceId: string }>(url, query, { spaceId }),
    retryOptions
  );
  return graphqlData.proposals;
};

// Get all proposals on supported oSnap modules that have not been discarded. Discards are most likely due to disputes,
// but can also occur on OOv3 upgrades.
const getUndiscardedProposals = async (
  supportedModules: SupportedModules,
  params: MonitoringParams
): Promise<Array<TransactionsProposedEvent>> => {
  // Get all proposals for all supported modules.
  const allProposals = (
    await Promise.all(
      Object.keys(supportedModules).map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<TransactionsProposedEvent>(og, og.filters.TransactionsProposed(), {
          start: 0,
          end: params.blockRange.end,
        });
      })
    )
  ).flat();

  // Get all deleted proposals for all supported modules.
  const deletedProposals = (
    await Promise.all(
      Object.keys(supportedModules).map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<ProposalDeletedEvent>(og, og.filters.ProposalDeleted(), {
          start: 0,
          end: params.blockRange.end,
        });
      })
    )
  ).flat();

  // Filter out all proposals that have been deleted by matching assertionId. assertionId should be sufficient property
  // for filtering as it is derived from module address, transaction content and assertion time among other factors.
  const deletedAssertionIds = deletedProposals.map((deletedProposal) => deletedProposal.args.assertionId);
  return allProposals.filter((proposal) => !deletedAssertionIds.includes(proposal.args.assertionId));
};

// Checks if a safeSnap safe from Snapshot proposal is supported by oSnap automation.
const isSafeSupported = (safe: SafeSnapSafe, supportedModules: SupportedModules, chainId: number): boolean => {
  for (const ogAddress in supportedModules) {
    if (isMatchingSafe(safe, chainId, ogAddress)) return true;
  }
  return false;
};

export const proposeTransactions = async (logger: typeof Logger, params: MonitoringParams): Promise<void> => {
  // Get supported modules and spaces.
  const supportedModules = await getSupportedModules(params);
  const supportedSpaces = Array.from(
    new Set(Object.values(supportedModules).map((supportedModule) => supportedModule.parsedRules.space))
  );

  // Get all finalized basic safeSnap proposals for supported spaces.
  const snapshotProposals = (
    await Promise.all(
      supportedSpaces.map(async (space) => getSnapshotProposals(space, params.graphqlEndpoint, params.retryOptions))
    )
  ).flat();
  snapshotProposals.map((proposal) => {
    assert(proposal.plugins.safeSnap !== undefined, "Proposal does not have safeSnap plugin.");
  });

  // Get all undiscarded on-chain proposals for supported modules.
  const onChainProposals = await getUndiscardedProposals(supportedModules, params);
};
