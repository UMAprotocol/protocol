import {
  ProposalDeletedEvent,
  ProposalExecutedEvent,
  SetCollateralAndBondEvent,
  SetEscalationManagerEvent,
  SetIdentifierEvent,
  SetLivenessEvent,
  SetRulesEvent,
  TargetSetEvent,
  TransactionExecutedEvent,
  TransactionsProposedEvent,
} from "@uma/contracts-node/typechain/core/ethers/OptimisticGovernor";
import {
  ethersConstants,
  getProxyDeploymentTxs,
  Logger,
  MonitoringParams,
  runQueryFilter,
  getOgByAddress,
  getOo,
  tryHexToUtf8String,
} from "./common";
import { logProposalDeleted, logProposalExecuted, logSetCollateralAndBond, logSetRules } from "./MonitorLogger";
import {
  logProxyDeployed,
  logSetIdentifier,
  logSetLiveness,
  logTransactions,
  logTransactionsExecuted,
  logSetEscalationManager,
} from "./MonitorLogger";

// TEMP
import request from "graphql-request";

// If there are multiple transactions within a batch, they are aggregated as multiSend in the mainTransaction.
interface MainTransaction {
  to: string;
  data: string;
  value: string;
  operation: string;
}

// We only include properties that will be verified by the bot.
interface SafeSnapSafe {
  txs: { mainTransaction: MainTransaction }[];
  network: string;
  umaAddress: string;
}

interface SafeSnapPlugin {
  safeSnap: { safes: SafeSnapSafe[] };
}

// We only type the properties requested in the GraphQL query.
// Properties that are optional in the GraphQL schema are set as potentially null.
interface SnapshotProposal {
  id: string;
  type: string | null;
  choices: string[];
  start: number;
  end: number;
  state: string;
  space: { id: string } | null;
  scores: number[] | null;
  quorum: number;
  scores_total: number | null;
  plugins: Partial<SafeSnapPlugin>; // This is any in the GraphQL schema, but we only care about potential safeSnap plugin.
}
export interface graphqlData {
  proposals: SnapshotProposal[];
}

export async function monitorTransactionsProposed(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const oo = await getOo(params);

  const transactions = (
    await Promise.all(
      params.ogAddresses.map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<TransactionsProposedEvent>(og, og.filters.TransactionsProposed(), params.blockRange);
      })
    )
  ).flat();

  const getAssertionEventIndex = async (assertionId: string): Promise<number> => {
    const assertionMade = await runQueryFilter(oo, oo.filters.AssertionMade(assertionId), params.blockRange);
    return assertionMade[0].logIndex; // There should only be one event matching unique assertionId.
  };

  const getGraphqlData = async (ipfsHash: string): Promise<graphqlData> => {
    const query = `
    {
      proposals (
        first: 2
        where: {
          ipfs: "${ipfsHash}"
        }
        orderBy: "created"
        orderDirection: desc
      ) {
        id
        type
        choices
        start
        end
        state
        space {
          id
        }
        scores
        quorum
        scores_total
        plugins
      }
    }
  `;
    const data = (await request(params.graphqlEndpoint, query)) as graphqlData;
    return data;
  };

  for (const transaction of transactions) {
    await logTransactions(
      logger,
      {
        og: transaction.address,
        proposer: transaction.args.proposer,
        proposalTime: transaction.args.proposalTime,
        assertionId: transaction.args.assertionId,
        proposalHash: transaction.args.proposalHash,
        explanation: transaction.args.explanation,
        rules: transaction.args.rules,
        challengeWindowEnds: transaction.args.challengeWindowEnds,
        tx: transaction.transactionHash,
        ooEventIndex: await getAssertionEventIndex(transaction.args.assertionId),
        graphqlData: await getGraphqlData(tryHexToUtf8String(transaction.args.explanation)),
      },
      params
    );
  }
}

export async function monitorTransactionsExecuted(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const transactions = (
    await Promise.all(
      params.ogAddresses.map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<TransactionExecutedEvent>(og, og.filters.TransactionExecuted(), params.blockRange);
      })
    )
  ).flat();
  for (const transaction of transactions) {
    await logTransactionsExecuted(
      logger,
      {
        og: transaction.address,
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
  const transactions = (
    await Promise.all(
      params.ogAddresses.map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<ProposalExecutedEvent>(og, og.filters.ProposalExecuted(), params.blockRange);
      })
    )
  ).flat();
  for (const transaction of transactions) {
    await logProposalExecuted(
      logger,
      {
        og: transaction.address,
        assertionId: transaction.args.assertionId,
        proposalHash: transaction.args.proposalHash,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorProposalDeleted(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const transactions = (
    await Promise.all(
      params.ogAddresses.map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<ProposalDeletedEvent>(og, og.filters.ProposalDeleted(), params.blockRange);
      })
    )
  ).flat();
  for (const transaction of transactions) {
    await logProposalDeleted(
      logger,
      {
        og: transaction.address,
        assertionId: transaction.args.assertionId,
        proposalHash: transaction.args.proposalHash,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorSetCollateralAndBond(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const transactions = (
    await Promise.all(
      params.ogAddresses.map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<SetCollateralAndBondEvent>(og, og.filters.SetCollateralAndBond(), params.blockRange);
      })
    )
  ).flat();
  for (const transaction of transactions) {
    await logSetCollateralAndBond(
      logger,
      {
        og: transaction.address,
        collateral: transaction.args.collateral,
        bond: transaction.args.bondAmount,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorSetRules(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const transactions = (
    await Promise.all(
      params.ogAddresses.map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<SetRulesEvent>(og, og.filters.SetRules(), params.blockRange);
      })
    )
  ).flat();
  for (const transaction of transactions) {
    await logSetRules(
      logger,
      { og: transaction.address, rules: transaction.args.rules, tx: transaction.transactionHash },
      params
    );
  }
}

export async function monitorSetLiveness(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const transactions = (
    await Promise.all(
      params.ogAddresses.map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<SetLivenessEvent>(og, og.filters.SetLiveness(), params.blockRange);
      })
    )
  ).flat();
  for (const transaction of transactions) {
    await logSetLiveness(
      logger,
      { og: transaction.address, liveness: transaction.args.liveness, tx: transaction.transactionHash },
      params
    );
  }
}

export async function monitorSetIdentifier(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const transactions = (
    await Promise.all(
      params.ogAddresses.map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<SetIdentifierEvent>(og, og.filters.SetIdentifier(), params.blockRange);
      })
    )
  ).flat();
  for (const transaction of transactions) {
    await logSetIdentifier(
      logger,
      { og: transaction.address, identifier: transaction.args.identifier, tx: transaction.transactionHash },
      params
    );
  }
}

export async function monitorSetEscalationManager(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const transactions = (
    await Promise.all(
      params.ogAddresses.map(async (ogAddress) => {
        const og = await getOgByAddress(params, ogAddress);
        return runQueryFilter<SetEscalationManagerEvent>(og, og.filters.SetEscalationManager(), params.blockRange);
      })
    )
  ).flat();
  for (const transaction of transactions) {
    await logSetEscalationManager(
      logger,
      {
        og: transaction.address,
        escalationManager: transaction.args.escalationManager,
        tx: transaction.transactionHash,
      },
      params
    );
  }
}

export async function monitorProxyDeployments(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const transactions = await getProxyDeploymentTxs(params);

  const getInitialTarget = async (ogAddress: string, blockNumber: number): Promise<string> => {
    const og = await getOgByAddress(params, ogAddress);
    const initialTargetSetEvent = (
      await runQueryFilter<TargetSetEvent>(og, og.filters.TargetSet(ethersConstants.AddressZero), {
        start: blockNumber,
        end: blockNumber,
      })
    )[0];
    return initialTargetSetEvent.args.newTarget;
  };

  for (const transaction of transactions) {
    await logProxyDeployed(
      logger,
      {
        proxy: transaction.args.proxy,
        masterCopy: transaction.args.masterCopy,
        tx: transaction.transactionHash,
        target: await getInitialTarget(transaction.args.proxy, transaction.blockNumber),
      },
      params
    );
  }
}
