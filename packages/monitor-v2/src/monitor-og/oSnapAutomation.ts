import type { Provider } from "@ethersproject/abstract-provider";
import type { Signer } from "@ethersproject/abstract-signer";
import { ERC20Ethers } from "@uma/contracts-node";
import {
  ProposalDeletedEvent,
  ProposalExecutedEvent,
  TransactionsProposedEvent,
} from "@uma/contracts-node/typechain/core/ethers/OptimisticGovernor";
import assert from "assert";
import retry, { Options as RetryOptions } from "async-retry";
import { ContractReceipt, utils as ethersUtils } from "ethers";
import { request } from "graphql-request";
import { gql } from "graphql-tag";

import { getEventTopic } from "../utils/contracts";
import { createSnapshotProposalLink } from "../utils/logger";
import { logSubmittedDispute, logSubmittedProposal } from "./MonitorLogger";

import {
  getBlockTimestamp,
  getContractInstanceWithProvider,
  getOgByAddress,
  getOo,
  Logger,
  MonitoringParams,
  runQueryFilter,
  SupportedBonds,
  tryHexToUtf8String,
} from "./common";
import {
  GraphqlData,
  isMatchingSafe,
  isSnapshotProposalGraphql,
  parseRules,
  onChainTxsMatchSnapshot,
  RulesParameters,
  SafeSnapSafe,
  SnapshotProposalGraphql,
  VerificationResponse,
  verifyIpfs,
  verifyProposal,
  verifyRules,
  verifyVoteOutcome,
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
export interface SnapshotProposalExpanded extends Omit<SnapshotProposalGraphql, "plugins"> {
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

const getModuleParameters = (ogAddress: string, supportedModules: SupportedModules): SupportedParameters => {
  return supportedModules[ethersUtils.getAddress(ogAddress)];
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
  const expandedProposals: SnapshotProposalExpanded[] = snapshotProposals.flatMap((proposal) => {
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

// Verifies proposals before they are proposed on-chain.
const filterVerifiedProposals = async (
  proposals: SnapshotProposalExpanded[],
  supportedModules: SupportedModules,
  params: MonitoringParams
): Promise<SnapshotProposalExpanded[]> => {
  // Convert expanded proposals back to GraphqlData format as this is used in SnapshotVerification.
  const graphqlData: GraphqlData = {
    proposals: proposals.map((proposal) => {
      const { safe, ...clonedObject } = proposal;
      return { ...clonedObject, plugins: { safeSnap: { safes: [safe] } } };
    }),
  };

  // Verify all potential proposals.
  const lastTimestamp = await getBlockTimestamp(params.provider, params.blockRange.end);
  const verifiedProposals = (
    await Promise.all(
      graphqlData.proposals.map(async (proposal) => {
        // Check that the proposal was approved properly on Snapshot assuming we are at the end block timestamp.
        const voteOutcomVerified = verifyVoteOutcome(proposal, lastTimestamp, 0).verified;

        // Check that proposal is hosted on IPFS and its content matches.
        const ipfsVerified = (await verifyIpfs(proposal, params)).verified;

        // Check that the proposal meets rules requirements for the target oSnap module.
        const rulesVerified = verifyRules(
          getModuleParameters(proposal.plugins.safeSnap.safes[0].umaAddress, supportedModules).parsedRules,
          proposal
        ).verified;

        // Return verification result together with original proposal. This is used for filtering below.
        return { verified: voteOutcomVerified && ipfsVerified && rulesVerified, proposal };
      })
    )
  ).filter((proposal) => proposal.verified); // Filter out all proposals that did not pass verification.

  // Convert back to SnapshotProposalExpanded format.
  return verifiedProposals.map((verificationResult) => {
    const proposal = verificationResult.proposal;
    const { plugins, ...clonedObject } = proposal;
    return { ...clonedObject, safe: proposal.plugins.safeSnap.safes[0] };
  });
};

// Filters out all proposals that have been executed on-chain. This includes proposals both before and after their
// challenge period.
const filterUnexecutedProposals = async (
  proposals: TransactionsProposedEvent[],
  params: MonitoringParams
): Promise<TransactionsProposedEvent[]> => {
  // Get all assertion Ids from executed proposals covering modules in input proposals.
  const executedAssertionIds = (
    await Promise.all(
      Array.from(new Set(proposals.map((proposal) => proposal.address))).map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        const executedProposals = await runQueryFilter<ProposalExecutedEvent>(og, og.filters.ProposalExecuted(), {
          start: 0,
          end: params.blockRange.end,
        });
        return executedProposals.map((executedProposal) => executedProposal.args.assertionId);
      })
    )
  ).flat();

  // Filter out all proposals that have been executed based on matching assertionId.
  return proposals.filter((proposal) => !executedAssertionIds.includes(proposal.args.assertionId));
};

// Filter function to check if challenge period has passed for a proposal.
const hasChallengePeriodEnded = (proposal: TransactionsProposedEvent, timestamp: number): boolean => {
  return timestamp >= proposal.args.challengeWindowEnds.toNumber();
};

const approveBond = async (
  provider: Provider,
  signer: Signer,
  currency: string,
  bond: string,
  spender: string
): Promise<void> => {
  // If bond is 0, no need to approve.
  if (bond === "0") return;

  // If existing approval matches the bond, no need to proceed.
  const currencyContract = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, currency);
  const currentAllowance = await currencyContract.allowance(await signer.getAddress(), spender);
  if (currentAllowance.toString() === bond) return;

  try {
    await (await currencyContract.connect(signer).approve(spender, bond)).wait();
  } catch (error) {
    assert(error instanceof Error, "Unexpected Error type!");
    throw new Error(`Bond approval for ${spender} failed: ${error.message}`);
  }
};

const submitProposals = async (
  logger: typeof Logger,
  proposals: SnapshotProposalExpanded[],
  supportedModules: SupportedModules,
  params: MonitoringParams
) => {
  assert(params.signer !== undefined, "Signer must be set to propose transactions.");

  for (const proposal of proposals) {
    const og = await getOgByAddress(params, proposal.safe.umaAddress);

    // Approve bond based on stored module parameters.
    const moduleParameters = getModuleParameters(proposal.safe.umaAddress, supportedModules);
    await approveBond(params.provider, params.signer, moduleParameters.currency, moduleParameters.bond, og.address);

    // Create transaction parameters.
    const transactions = proposal.safe.txs.map((transaction) => {
      return {
        to: transaction.mainTransaction.to,
        operation: transaction.mainTransaction.operation,
        value: transaction.mainTransaction.value,
        data: transaction.mainTransaction.data,
      };
    });
    const explanation = ethersUtils.toUtf8Bytes(proposal.ipfs);

    // Prepare potential error message for simulating/proposing.
    const proposalError = `Proposal submission for ${createSnapshotProposalLink(
      params.snapshotEndpoint,
      proposal.space.id,
      proposal.id
    )}`;

    // Check that proposal submission would succeed.
    try {
      await og.callStatic.proposeTransactions(transactions, explanation, { from: await params.signer.getAddress() });
    } catch (error) {
      assert(error instanceof Error, "Unexpected Error type!");
      // TODO: We should separately handle the duplicate proposals error. This can occur if there are multiple proposals
      // with the same transactions (e.g. funding in same amount tranches split across multiple proposals). We should
      // only warn when first encountering the blocking proposal and then ignore it in any future runs.
      throw new Error(`${proposalError} would fail: ${error.message}`);
    }

    // Submit proposal and get receipt.
    let receipt: ContractReceipt;
    try {
      const tx = await og.connect(params.signer).proposeTransactions(transactions, explanation);
      receipt = await tx.wait();
    } catch (error) {
      assert(error instanceof Error, "Unexpected Error type!");
      throw new Error(`${proposalError} failed: ${error.message}`);
    }

    // Log submitted proposal.
    const ogEvent = receipt.events?.find((e): e is TransactionsProposedEvent => e.event === "TransactionsProposed");
    const ooEvent = receipt.events?.find((e) => e.topics[0] === getEventTopic("OptimisticOracleV3", "AssertionMade"));
    assert(ogEvent !== undefined, "TransactionsProposed event not found.");
    assert(ooEvent !== undefined, "AssertionMade event not found.");
    await logSubmittedProposal(
      logger,
      {
        og: og.address,
        tx: receipt.transactionHash,
        ooEventIndex: ooEvent.logIndex,
      },
      proposal,
      params
    );
  }
};

const submitDisputes = async (
  logger: typeof Logger,
  proposals: { proposalEvent: TransactionsProposedEvent; verificationResult: VerificationResponse }[],
  supportedModules: SupportedModules,
  params: MonitoringParams
) => {
  assert(params.signer !== undefined, "Signer must be set to dispute proposals.");
  const disputerAddress = await params.signer.getAddress();

  for (const proposal of proposals) {
    const oo = await getOo(params);

    // Approve bond based on stored module parameters.
    const moduleParameters = getModuleParameters(proposal.proposalEvent.address, supportedModules);
    await approveBond(params.provider, params.signer, moduleParameters.currency, moduleParameters.bond, oo.address);

    // Prepare potential error message for simulating/disputing.
    const disputeError =
      "Dispute submission on assertionId " +
      proposal.proposalEvent.args.assertionId +
      " related to proposalHash " +
      proposal.proposalEvent.args.proposalHash +
      " posted on oSnap module " +
      proposal.proposalEvent.address +
      " for Snapshot space " +
      moduleParameters.parsedRules.space;

    // Check that dispute submission would succeed.
    try {
      await oo.callStatic.disputeAssertion(proposal.proposalEvent.args.assertionId, disputerAddress, {
        from: disputerAddress,
      });
    } catch (error) {
      assert(error instanceof Error, "Unexpected Error type!");
      throw new Error(`${disputeError} would fail: ${error.message}`);
    }

    // Submit dispute and get receipt.
    let receipt: ContractReceipt;
    try {
      const tx = await oo
        .connect(params.signer)
        .disputeAssertion(proposal.proposalEvent.args.assertionId, disputerAddress);
      receipt = await tx.wait();
    } catch (error) {
      assert(error instanceof Error, "Unexpected Error type!");
      throw new Error(`${disputeError} failed: ${error.message}`);
    }

    // Log submitted dispute.
    const disputeEvent = receipt.events?.find((e) => e.event === "AssertionDisputed");
    assert(disputeEvent !== undefined, "AssertionDisputed event not found.");
    await logSubmittedDispute(logger, proposal, disputeEvent.transactionHash, params);
  }
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
  const verifiedProposals = await filterVerifiedProposals(potentialProposals, supportedModules, params);

  // Submit proposals.
  await submitProposals(logger, verifiedProposals, supportedModules, params);
};

export const disputeProposals = async (logger: typeof Logger, params: MonitoringParams): Promise<void> => {
  // Get supported modules.
  const supportedModules = await getSupportedModules(params);

  // Get all undiscarded on-chain proposals for supported modules.
  const onChainProposals = await getUndiscardedProposals(supportedModules, params);

  // Filter out all proposals that have been executed on-chain.
  const unexecutedProposals = await filterUnexecutedProposals(onChainProposals, params);

  // Filter out all proposals that have not passed their challenge period.
  const lastTimestamp = await getBlockTimestamp(params.provider, params.blockRange.end);
  const liveProposals = unexecutedProposals.filter((proposal) => !hasChallengePeriodEnded(proposal, lastTimestamp));

  // Filter proposals that did not pass verification and also retain verification result for logging.
  const disputableProposals = (
    await Promise.all(
      liveProposals.map(async (proposalEvent) => {
        const verificationResult = await verifyProposal(proposalEvent, params);
        return { proposalEvent, verificationResult };
      })
    )
  ).filter((proposal) => !proposal.verificationResult.verified);

  // Submit disputes.
  await submitDisputes(logger, disputableProposals, supportedModules, params);
};