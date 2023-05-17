import { createEtherscanLinkMarkdown } from "@uma/common";
import { BigNumber } from "ethers";
import { generateOOv3UILink, Logger, tryHexToUtf8String } from "./common";

import type { MonitoringParams } from "./common";

export async function logTransactions(
  logger: typeof Logger,
  transaction: {
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
  transaction: { assertionId: string; proposalHash: string; transactionIndex: BigNumber; tx: string },
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
      " have been executed in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId) +
      " with trasaaction index " +
      transaction.transactionIndex.toString(),
    notificationPath: "optimistic-governor",
  });
}

export async function logProposalExecuted(
  logger: typeof Logger,
  transaction: { assertionId: string; proposalHash: string; tx: string },
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
      " has been executed in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logProposalDeleted(
  logger: typeof Logger,
  transaction: { assertionId: string; proposalHash: string; tx: string },
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
      " has been deleted in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetCollateralAndBond(
  logger: typeof Logger,
  transaction: { collateral: string; bond: BigNumber; tx: string },
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
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetRules(
  logger: typeof Logger,
  transaction: { rules: string; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Rules Set 📝",
    mrkdwn:
      " Rules " +
      tryHexToUtf8String(transaction.rules) +
      " have been set in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetLiveness(
  logger: typeof Logger,
  transaction: { liveness: BigNumber; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Liveness Set 📝",
    mrkdwn:
      " Liveness has been set to " +
      transaction.liveness.toString() +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetIdentifier(
  logger: typeof Logger,
  transaction: { identifier: string; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Identifier Set 📝",
    mrkdwn:
      " Identifier " +
      transaction.identifier +
      " has been set in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logSetEscalationManager(
  logger: typeof Logger,
  transaction: { escalationManager: string; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Escalation Manager Set 📝",
    mrkdwn:
      " Escalation Manager " +
      createEtherscanLinkMarkdown(transaction.escalationManager, params.chainId) +
      " has been set in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}

export async function logProxyDeployed(
  logger: typeof Logger,
  transaction: { proxy: string; masterCopy: string; tx: string },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
    at: "OptimisticGovernorMonitor",
    message: "Proxy Deployed 📝",
    mrkdwn:
      " Proxy " +
      createEtherscanLinkMarkdown(transaction.proxy, params.chainId) +
      " has been deployed with master copy " +
      createEtherscanLinkMarkdown(transaction.masterCopy, params.chainId) +
      " in transaction " +
      createEtherscanLinkMarkdown(transaction.tx, params.chainId),
    notificationPath: "optimistic-governor",
  });
}
