import type { Provider } from "@ethersproject/abstract-provider";
import type { Signer } from "@ethersproject/abstract-signer";
import { ERC20Ethers } from "@uma/contracts-node";
import {
  ProposalDeletedEvent,
  ProposalExecutedEvent,
  TransactionsProposedEvent,
} from "@uma/contracts-node/typechain/core/ethers/OptimisticGovernor";
import assert from "assert";
import { ContractReceipt, utils as ethersUtils } from "ethers";

import { logSubmittedDispute } from "./MonitorLogger";

import {
  getBlockTimestamp,
  getContractInstanceWithProvider,
  getOgByAddress,
  getOo,
  Logger,
  MonitoringParams,
  runQueryFilter,
  SupportedBonds,
} from "./common";
import { parseRules, RulesParameters, VerificationResponse, verifyProposal } from "./SnapshotVerification";

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

const getModuleParameters = (ogAddress: string, supportedModules: SupportedModules): SupportedParameters => {
  return supportedModules[ethersUtils.getAddress(ogAddress)];
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

// Filters out all proposals that have been executed on-chain. This results in proposals both before and after their
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
  // TODO: We should separately handle IPFS and Graphql server errors. We don't want to submit disputes immediately just
  // because IPFS gateway or Snapshot backend is down.
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
