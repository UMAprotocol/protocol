import { createEtherscanLinkMarkdown } from "@uma/common";
import { BigNumber } from "ethers";
import { generateOOv3UILink, Logger, tryHexToUtf8String } from "./common";

import type { MonitoringParams } from "./common";

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
  params: MonitoringParams
): Promise<void> {
  logger.error({
    at: "OptimisticGovernorMonitor",
    message: "Transactions Proposed 📝",
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
      ". Rules: " +
      tryHexToUtf8String(transaction.rules) +
      ". Explanation: " +
      tryHexToUtf8String(transaction.explanation) +
      ". The proposal can be disputed till " +
      new Date(Number(transaction.challengeWindowEnds.toString()) * 1000).toUTCString() +
      ": " +
      generateOOv3UILink(transaction.tx, transaction.ooEventIndex, params.chainId) +
      ".",
    notificationPath: "optimistic-governor",
  });
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
