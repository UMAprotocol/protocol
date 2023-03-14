import { getContractInstanceWithProvider, Logger, MonitoringParams, OptimisticGovernorEthers } from "./common";
import {
  logProposalDeleted,
  logProposalExecuted,
  logSetBond,
  logSetCollateral,
  logSetEscalationManager,
  logSetIdentifier,
  logSetLiveness,
  logSetRules,
  logTransactions,
  logTransactionsExecuted,
} from "./MonitorLogger";

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

export async function monitorProposalDeleted(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(
    og.filters.ProposalDeleted(),
    params.blockRange.start,
    params.blockRange.end
  );
  for (const transaction of transactions) {
    await logProposalDeleted(
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

export async function monitorSetBond(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(og.filters.SetBond(), params.blockRange.start, params.blockRange.end);
  for (const transaction of transactions) {
    await logSetBond(
      logger,
      {
        bond: transaction.args.bondAmount,
        collateral: transaction.args.collateral,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorSetCollateral(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(og.filters.SetCollateral(), params.blockRange.start, params.blockRange.end);
  for (const transaction of transactions) {
    await logSetCollateral(
      logger,
      {
        collateral: transaction.args.collateral,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorSetRules(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(og.filters.SetRules(), params.blockRange.start, params.blockRange.end);
  for (const transaction of transactions) {
    await logSetRules(
      logger,
      {
        rules: transaction.args.rules,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorSetLiveness(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(og.filters.SetLiveness(), params.blockRange.start, params.blockRange.end);
  for (const transaction of transactions) {
    await logSetLiveness(
      logger,
      {
        liveness: transaction.args.liveness,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorSetIdentifier(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(og.filters.SetIdentifier(), params.blockRange.start, params.blockRange.end);
  for (const transaction of transactions) {
    await logSetIdentifier(
      logger,
      {
        identifier: transaction.args.identifier,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorSetEscalationManager(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getContractInstanceWithProvider<OptimisticGovernorEthers>("OptimisticGovernor", params.provider);

  const transactions = await og.queryFilter(
    og.filters.SetEscalationManager(),
    params.blockRange.start,
    params.blockRange.end
  );
  for (const transaction of transactions) {
    await logSetEscalationManager(
      logger,
      {
        escalationManager: transaction.args.escalationManager,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}
