import { createEtherscanLinkMarkdown } from "@uma/common";
import { BigNumber } from "ethers";
import { Logger, tryHexToUtf8String } from "./common";

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
  },
  params: MonitoringParams
): Promise<void> {
  logger.warn({
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
      new Date(Number(transaction.challengeWindowEnds.toString()) * 1000).toUTCString(),
    notificationPath: "optimistic-governor",
  });
}

export async function logTransactionsExecuted(
  logger: typeof Logger,
  transaction: {
    assertionId: string;
    proposalHash: string;
    transactionIndex: BigNumber;
    tx: string;
  },
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
  transaction: {
    assertionId: string;
    proposalHash: string;
    tx: string;
  },
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
