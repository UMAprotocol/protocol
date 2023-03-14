import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticGovernorEthers } from "./common";
import { logTransactions } from "./MonitorLogger";

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
        proposal: transaction.args.proposal,
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
