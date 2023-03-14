import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticGovernorEthers } from "./common";
import { logProposalExecuted, logTransactions, logTransactionsExecuted } from "./MonitorLogger";

export async function monitorTransactionsProposed(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(
    og.filters.TransactionsProposed(),
    params.blockRange.start,
    params.blockRange.end
  );

  for (const transaction of transactions) {
    await logTransactions(
      logger,
      {
        proposer: transaction.args.proposer,
        proposalTime: transaction.args.proposalTime,
        assertionId: transaction.args.assertionId,
        proposalHash: transaction.args.proposalHash,
        explanation: transaction.args.explanation,
        rules: transaction.args.rules,
        challengeWindowEnds: transaction.args.challengeWindowEnds,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorTransactionsExecuted(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(
    og.filters.TransactionExecuted(),
    params.blockRange.start,
    params.blockRange.end
  );
  for (const transaction of transactions) {
    await logTransactionsExecuted(
      logger,
      {
        assertionId: transaction.args.assertionId,
        proposalHash: transaction.args.proposalHash,
        transactionIndex: transaction.args.transactionIndex,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}
export async function monitorProposalExecuted(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(
    og.filters.ProposalExecuted(),
    params.blockRange.start,
    params.blockRange.end
  );
  for (const transaction of transactions) {
    await logProposalExecuted(
      logger,
      {
        assertionId: transaction.args.assertionId,
        proposalHash: transaction.args.proposalHash,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}
