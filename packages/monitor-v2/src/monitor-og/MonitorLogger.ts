import { createEtherscanLinkMarkdown, TenderlySimulationResult } from "@uma/common";
import { BigNumber } from "ethers";

import { createSnapshotProposalLink, createTenderlyForkLink, createTenderlySimulationLink } from "../utils/logger";
import { ForkedTenderlyResult, generateOOv3UILink, MonitoringParams, Logger, tryHexToUtf8String } from "./common";
import { DisputableProposal, SnapshotProposalExpanded, SupportedProposal } from "./oSnapAutomation";
import { SnapshotProposalGraphql, VerificationResponse } from "./SnapshotVerification";

interface ProposalLogContent {
  at: string;
  message: string;
  mrkdwn: string;
  rules: string;
  notificationPath: string;
  verificationError?: string;
}

export async function logTransactions(
  logger: typeof Logger,
  transaction: {
    og: string;
    proposer: string;
    proposalTime: BigNumber;
    assertionId: string;
    proposalHash: string;
    explanation: string;
    rules: string;
    challengeWindowEnds: BigNumber;
    tx: string;
    ooEventIndex: number;
  },
  params: MonitoringParams,
  snapshotVerification: VerificationResponse,
  simulationResult?: TenderlySimulationResult
): Promise<void> {
  const logLevel = snapshotVerification.verified ? "info" : "error";
  const logContent: ProposalLogContent = {
    at: "OptimisticGovernorMonitor",
    message: snapshotVerification.verified
      ? "Verified Transactions Proposed 📝"
      : "Unverified Transactions Proposed 🚩",
    mrkdwn:
      createEtherscanLinkMarkdown(transaction.proposer, params.chainId) +
      " made a proposal with hash " +
      transaction.proposalHash +
      " and assertion ID " +
      transaction.assertionId +
      " on Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " at " +
      new Date(Number(transaction.proposalTime.toString()) * 1000).toUTCString() +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId) +
      ". Explanation: " +
      tryHexToUtf8String(transaction.explanation) +
      ". The proposal can be disputed till " +
      new Date(Number(transaction.challengeWindowEnds.toString()) * 1000).toUTCString() +
      ": " +
      generateOOv3UILink(transaction.tx, transaction.ooEventIndex, params.chainId) +
      ". " +
      createTenderlySimulationLink(simulationResult) +
      ".",
    rules: tryHexToUtf8String(transaction.rules),
    notificationPath: "optimistic-governor",
  };
  if (!snapshotVerification.verified) {
    logContent.verificationError = snapshotVerification.error;
  }
  logger[logLevel](logContent);
}

export async function logTransactionsExecuted(
  logger: typeof Logger,
  transaction: { og: string; assertionId: string; proposalHash: string; transactionIndex: BigNumber; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Transactions Executed ✅",
    mrkdwn:
      " Transactions with hash " +
      transaction.proposalHash +
      " and assertion ID " +
      transaction.assertionId +
      " have been executed on Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId) +
      " with trasaaction index " +
      transaction.transactionIndex.toString(),
    notificationPath: "optimistic-governor",
  });
}

export async function logProposalExecuted(
  logger: typeof Logger,
  transaction: { og: string; assertionId: string; proposalHash: string; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Proposal Executed ✅",
    mrkdwn:
      " Proposal with hash " +
      transaction.proposalHash +
      " and assertion ID " +
      transaction.assertionId +
      " has been executed on Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logProposalDeleted(
  logger: typeof Logger,
  transaction: { og: string; assertionId: string; proposalHash: string; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.error({
    at: "OptimisticGovernorMonitor",
    message: "Proposal Deleted 🗑️",
    mrkdwn:
      " Proposal with hash " +
      transaction.proposalHash +
      " and assertion ID " +
      transaction.assertionId +
      " has been deleted from Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetCollateralAndBond(
  logger: typeof Logger,
  transaction: { og: string; collateral: string; bond: BigNumber; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Collateral And Bond Set 📝",
    mrkdwn:
      " Bond has been set to " +
      transaction.bond.toString() +
      " for collateral " +
      transaction.collateral +
      " on Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetRules(
  logger: typeof Logger,
  transaction: { og: string; rules: string; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Rules Set 📝",
    mrkdwn:
      " Rules " +
      tryHexToUtf8String(transaction.rules) +
      " have been set on Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetLiveness(
  logger: typeof Logger,
  transaction: { og: string; liveness: BigNumber; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Liveness Set 📝",
    mrkdwn:
      " Liveness has been set to " +
      transaction.liveness.toString() +
      " on Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetIdentifier(
  logger: typeof Logger,
  transaction: { og: string; identifier: string; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Identifier Set 📝",
    mrkdwn:
      " Identifier " +
      transaction.identifier +
      " has been set on Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetEscalationManager(
  logger: typeof Logger,
  transaction: { og: string; escalationManager: string; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Escalation Manager Set 📝",
    mrkdwn:
      " Escalation Manager " +
      createEtherscanLinkMarkdown(transaction.escalationManager, params.chainId) +
      " has been set on Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logProxyDeployed(
  logger: typeof Logger,
  transaction: { proxy: string; masterCopy: string; tx: string; target: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Optimistic Governor Deployed 📝",
    mrkdwn:
      " Optimistic Governor " +
      createEtherscanLinkMarkdown(transaction.proxy, params.chainId) +
      " controlling target contract " +
      createEtherscanLinkMarkdown(transaction.target, params.chainId) +
      " has been deployed from master copy " +
      createEtherscanLinkMarkdown(transaction.masterCopy, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSubmittedProposal(
  logger: typeof Logger,
  transaction: {
    og: string;
    tx: string;
    ooEventIndex: number;
  },
  proposal: SnapshotProposalExpanded,
  params: MonitoringParams
): Promise<void> {
  logger.info({
    at: "oSnapAutomation",
    message: "Submitted oSnap Proposal 🚀",
    mrkdwn:
      "Submitted oSnap proposal on supported oSnap module " +
      createEtherscanLinkMarkdown(transaction.og, params.chainId) +
      " for " +
      proposal.space.id +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId) +
      ". More details: " +
      createSnapshotProposalLink(params.snapshotEndpoint, proposal.space.id, proposal.id) +
      " and assertion: " +
      generateOOv3UILink(transaction.tx, transaction.ooEventIndex, params.chainId) +
      ".",
    notificationPath: "optimistic-governor",
  });
}

export async function logSubmittedDispute(
  logger: typeof Logger,
  proposal: DisputableProposal,
  disputeTx: string,
  params: MonitoringParams
): Promise<void> {
  logger.info({
    at: "oSnapAutomation",
    message: "Submitted oSnap Dispute 🚨",
    mrkdwn:
      "Submitted dispute on oSnap proposal with proposalHash " +
      proposal.event.args.proposalHash +
      " and assertionId " +
      proposal.event.args.assertionId +
      " posted on oSnap module " +
      createEtherscanLinkMarkdown(proposal.event.address, params.chainId) +
      " at Snapshot space " +
      proposal.parameters.parsedRules.space +
      " in transaction " +
      createEtherscanLinkMarkdown(disputeTx, params.chainId) +
      ". Reason for dispute: " +
      proposal.verificationResult.error,
    notificationPath: "optimistic-governor",
  });
}

export async function logSubmittedExecution(
  logger: typeof Logger,
  proposal: SupportedProposal,
  executeTx: string,
  params: MonitoringParams
): Promise<void> {
  logger.info({
    at: "oSnapAutomation",
    message: "Submitted oSnap Execution 🏁",
    mrkdwn:
      "Executed oSnap proposal with proposalHash " +
      proposal.event.args.proposalHash +
      " posted on oSnap module " +
      createEtherscanLinkMarkdown(proposal.event.address, params.chainId) +
      " at Snapshot space " +
      proposal.parameters.parsedRules.space +
      " in transaction " +
      createEtherscanLinkMarkdown(executeTx, params.chainId) +
      ".",
    notificationPath: "optimistic-governor",
  });
}

export function logSnapshotProposal(
  logger: typeof Logger,
  proposal: SnapshotProposalGraphql,
  params: MonitoringParams,
  simulationResults: ForkedTenderlyResult[]
): void {
  // If any of the simulations reverted, log as error, otherwise log as info.
  const logLevel = simulationResults.every((simulationResult) => simulationResult.lastSimulation.status)
    ? "info"
    : "error";
  const simulationLinks = simulationResults
    .map(
      (simulationResult) =>
        createTenderlySimulationLink(simulationResult.lastSimulation) +
        " on " +
        createTenderlyForkLink(simulationResult.forkUrl)
    )
    .join(", ");
  logger[logLevel]({
    at: "oSnapMonitor",
    message: "Snapshot Proposal Created 📝",
    mrkdwn:
      "Snapshot proposal for " +
      proposal.space.id +
      " with id " +
      proposal.id +
      " has been created. More details: " +
      createSnapshotProposalLink(params.snapshotEndpoint, proposal.space.id, proposal.id) +
      ". " +
      simulationLinks +
      ".",
    notificationPath: "optimistic-governor",
    discordTicketChannel: "verifications-start-here",
  });
}
