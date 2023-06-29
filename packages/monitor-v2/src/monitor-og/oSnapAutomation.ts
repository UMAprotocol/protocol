import {
  ProposalDeletedEvent,
  TransactionsProposedEvent,
} from "@uma/contracts-node/typechain/core/ethers/OptimisticGovernor";
import retry, { Options as RetryOptions } from "async-retry";
import { utils as ethersUtils } from "ethers";
import { request } from "graphql-request";
import { gql } from "graphql-tag";

import { getOgByAddress, Logger, MonitoringParams, runQueryFilter, SupportedBonds, tryHexToUtf8String } from "./common";
import {
  GraphqlData,
  isMatchingSafe,
  isSnapshotProposalGraphql,
  parseRules,
  onChainTxsMatchSnapshot,
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

// Expanded interface for easier processing of Snapshot proposals. Original Snapshot proposal can contain multiple safes
// that would need to be proposed on-chain separately. SafeSnapSafe array of plugins.safeSnap.safes from the original
// Snapshot proposal is flattened into multiple SnapshotProposalExpanded objects. Each SnapshotProposalExpanded object
// contains one safe from the original Snapshot proposal together with all other properties from the original Snapshot
// proposal.
interface SnapshotProposalExpanded extends Omit<SnapshotProposalGraphql, "plugins"> {
  safe: SafeSnapSafe;
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
  // Filter only for proposals that have a properly configured safeSnap plugin.
  return graphqlData.proposals.filter(isSnapshotProposalGraphql);
};

// Get all finalized basic safeSnap proposals for supported spaces and safes.
const getSupportedSnapshotProposals = async (
  supportedModules: SupportedModules,
  params: MonitoringParams
): Promise<Array<SnapshotProposalExpanded>> => {
  // Get supported space names from supported modules.
  const supportedSpaces = Array.from(
    new Set(Object.values(supportedModules).map((supportedModule) => supportedModule.parsedRules.space))
  );

  // Get all finalized basic safeSnap proposals for supported spaces.
  const snapshotProposals = (
    await Promise.all(
      supportedSpaces.map(async (space) => getSnapshotProposals(space, params.graphqlEndpoint, params.retryOptions))
    )
  ).flat();

  // Expand Snapshot proposals to include only one safe per proposal.
  const expandedProposals = snapshotProposals.flatMap((proposal) => {
    const { plugins, ...clonedObject } = proposal;
    return proposal.plugins.safeSnap.safes.map((safe) => ({ ...clonedObject, safe }));
  });

  // Return only proposals from supported safes.
  return expandedProposals.filter((proposal) => isSafeSupported(proposal.safe, supportedModules, params.chainId));
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

// Filters out all Snapshot proposals that have been proposed on-chain. This is done by matching safe, explanation and
// proposed transactions.
const filterPotentialProposals = (
  supportedProposals: SnapshotProposalExpanded[],
  onChainProposals: TransactionsProposedEvent[],
  params: MonitoringParams
): SnapshotProposalExpanded[] => {
  return supportedProposals.filter((supportedProposal) => {
    const matchingOnChainProposals = onChainProposals.filter((onChainProposal) => {
      // Check if safe and explanation match
      if (
        isMatchingSafe(supportedProposal.safe, params.chainId, onChainProposal.address) &&
        supportedProposal.ipfs === tryHexToUtf8String(onChainProposal.args.explanation)
      ) {
        // Check if proposed transactions match
        return onChainTxsMatchSnapshot(onChainProposal, supportedProposal.safe);
      }
      return false;
    });
    // Exclude Snapshot proposals with matching on-chain proposals
    return matchingOnChainProposals.length === 0;
  });
};

export const proposeTransactions = async (logger: typeof Logger, params: MonitoringParams): Promise<void> => {
  // Get supported modules.
  const supportedModules = await getSupportedModules(params);

  // Get all finalized basic safeSnap proposals for supported spaces and safes.
  const supportedProposals = await getSupportedSnapshotProposals(supportedModules, params);

  // Get all undiscarded on-chain proposals for supported modules.
  const onChainProposals = await getUndiscardedProposals(supportedModules, params);

  // Filter Snapshot proposals that could potentially be proposed on-chain.
  const potentialProposals = filterPotentialProposals(supportedProposals, onChainProposals, params);
};
