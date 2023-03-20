import { Logger, MonitoringParams, runQueryFilter, getOg } from "./common";
import { logProposalDeleted, logProposalExecuted, logSetCollateralAndBond, logSetRules } from "./MonitorLogger";
import {
  logSetIdentifier,
  logSetLiveness,
  logTransactions,
  logTransactionsExecuted,
  logSetEscalationManager,
} from "./MonitorLogger";

export async function monitorTransactionsProposed(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const transactions = await runQueryFilter(og, og.filters.TransactionsProposed(), params.blockRange);
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
  const og = await getOg(params);
  const transactions = await runQueryFilter(og, og.filters.TransactionExecuted(), params.blockRange);
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
  const og = await getOg(params);
  const transactions = await runQueryFilter(og, og.filters.ProposalExecuted(), params.blockRange);
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
  const og = await getOg(params);
  const transactions = await runQueryFilter(og, og.filters.ProposalDeleted(), params.blockRange);
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

export async function monitorSetCollateralAndBond(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const transactions = await runQueryFilter(og, og.filters.SetCollateralAndBond(), params.blockRange);
  for (const transaction of transactions) {
    await logSetCollateralAndBond(
      logger,
      { collateral: transaction.args.collateral, bond: transaction.args.bondAmount, tx: transaction.transactionHash },
      params
    );
  }
}

export async function monitorSetRules(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const transactions = await runQueryFilter(og, og.filters.SetRules(), params.blockRange);
  for (const transaction of transactions) {
    await logSetRules(logger, { rules: transaction.args.rules, tx: transaction.transactionHash }, params);
  }
}

export async function monitorSetLiveness(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const transactions = await runQueryFilter(og, og.filters.SetLiveness(), params.blockRange);
  for (const transaction of transactions) {
    await logSetLiveness(logger, { liveness: transaction.args.liveness, tx: transaction.transactionHash }, params);
  }
}

export async function monitorSetIdentifier(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const transactions = await runQueryFilter(og, og.filters.SetIdentifier(), params.blockRange);
  for (const transaction of transactions) {
    await logSetIdentifier(
      logger,
      { identifier: transaction.args.identifier, tx: transaction.transactionHash },
      params
    );
  }
}

export async function monitorSetEscalationManager(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const transactions = await runQueryFilter(og, og.filters.SetEscalationManager(), params.blockRange);
  for (const transaction of transactions) {
    await logSetEscalationManager(
      logger,
      { escalationManager: transaction.args.escalationManager, tx: transaction.transactionHash },
      params
    );
  }
}
