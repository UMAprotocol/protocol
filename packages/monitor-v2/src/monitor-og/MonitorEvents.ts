import {
  ProposalDeletedEvent,
  ProposalExecutedEvent,
  SetCollateralAndBondEvent,
  SetEscalationManagerEvent,
  SetIdentifierEvent,
  SetLivenessEvent,
  SetRulesEvent,
  TransactionExecutedEvent,
  TransactionsProposedEvent,
} from "@uma/contracts-node/typechain/core/ethers/OptimisticGovernor";
import { getProxyDeployments, Logger, MonitoringParams, runQueryFilter, getOg, getOo } from "./common";
import { logProposalDeleted, logProposalExecuted, logSetCollateralAndBond, logSetRules } from "./MonitorLogger";
import {
  logProxyDeployed,
  logSetIdentifier,
  logSetLiveness,
  logTransactions,
  logTransactionsExecuted,
  logSetEscalationManager,
} from "./MonitorLogger";

export async function monitorTransactionsProposed(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const oo = await getOo(params);
  const transactions = await runQueryFilter<TransactionsProposedEvent>(
    og,
    og.filters.TransactionsProposed(),
    params.blockRange
  );

  const getAssertionEventIndex = async (assertionId: string): Promise<number> => {
    const assertionMade = await runQueryFilter(oo, oo.filters.AssertionMade(assertionId), params.blockRange);
    return assertionMade[0].logIndex; // There should only be one event matching unique assertionId.
  };

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
        ooEventIndex: await getAssertionEventIndex(transaction.args.assertionId),
      },
      params
    );
  }
}

export async function monitorTransactionsExecuted(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const transactions = await runQueryFilter<TransactionExecutedEvent>(
    og,
    og.filters.TransactionExecuted(),
    params.blockRange
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
  const og = await getOg(params);
  const transactions = await runQueryFilter<ProposalExecutedEvent>(
    og,
    og.filters.ProposalExecuted(),
    params.blockRange
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
  const og = await getOg(params);
  const transactions = await runQueryFilter<ProposalDeletedEvent>(og, og.filters.ProposalDeleted(), params.blockRange);
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
  const transactions = await runQueryFilter<SetCollateralAndBondEvent>(
    og,
    og.filters.SetCollateralAndBond(),
    params.blockRange
  );
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
  const transactions = await runQueryFilter<SetRulesEvent>(og, og.filters.SetRules(), params.blockRange);
  for (const transaction of transactions) {
    await logSetRules(logger, { rules: transaction.args.rules, tx: transaction.transactionHash }, params);
  }
}

export async function monitorSetLiveness(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const transactions = await runQueryFilter<SetLivenessEvent>(og, og.filters.SetLiveness(), params.blockRange);
  for (const transaction of transactions) {
    await logSetLiveness(logger, { liveness: transaction.args.liveness, tx: transaction.transactionHash }, params);
  }
}

export async function monitorSetIdentifier(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const og = await getOg(params);
  const transactions = await runQueryFilter<SetIdentifierEvent>(og, og.filters.SetIdentifier(), params.blockRange);
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
  const transactions = await runQueryFilter<SetEscalationManagerEvent>(
    og,
    og.filters.SetEscalationManager(),
    params.blockRange
  );
  for (const transaction of transactions) {
    await logSetEscalationManager(
      logger,
      { escalationManager: transaction.args.escalationManager, tx: transaction.transactionHash },
      params
    );
  }
}

export async function monitorProxyDeployments(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const transactions = await getProxyDeployments(params);
  for (const transaction of transactions) {
    await logProxyDeployed(
      logger,
      { proxy: transaction.args.proxy, masterCopy: transaction.args.masterCopy, tx: transaction.transactionHash },
      params
    );
  }
}
