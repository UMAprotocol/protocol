import { OptimisticOracleEthers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { paginatedEventQuery } from "../utils/EventUtils";
import {
  getContractInstanceWithProvider,
  getMarketsAncillary,
  getPolymarketMarkets,
  Logger,
  MonitoringParams,
} from "./common";

export async function monitorTransactionsProposed(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const currentBlockNumber = await params.provider.getBlockNumber();

  // These values are hardcoded for the Polygon network as this bot is only intended to run on Polygon.
  const maxBlockLookBack = 3499; // Polygons max block look back is 3499 blocks.
  const onDayInBlocks = 43200; // 1 day in blocks on Polygon is 43200 blocks.

  const searchConfig = {
    fromBlock: currentBlockNumber - onDayInBlocks < 0 ? 0 : currentBlockNumber - onDayInBlocks,
    toBlock: currentBlockNumber,
    maxBlockLookBack,
  };

  const oo = await getContractInstanceWithProvider<OptimisticOracleEthers>("OptimisticOracle", params.provider);
  const oov2 = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>("OptimisticOracleV2", params.provider);
  const eventsOo = paginatedEventQuery<ProposePriceEvent>(oo, oo.filters.ProposePrice(), searchConfig);
  const eventsOov2 = paginatedEventQuery<ProposePriceEvent>(oov2, oov2.filters.ProposePrice(), searchConfig);

  const markets = await getPolymarketMarkets(params);
  const marketsWithAncillary = await getMarketsAncillary(params, markets);

  console.log(marketsWithAncillary);

  // for (const transaction of transactions) {
  //   await logTransactions(
  //     logger,
  //     {
  //       proposer: transaction.args.proposer,
  //       proposalTime: transaction.args.proposalTime,
  //       assertionId: transaction.args.assertionId,
  //       proposalHash: transaction.args.proposalHash,
  //       explanation: transaction.args.explanation,
  //       rules: transaction.args.rules,
  //       challengeWindowEnds: transaction.args.challengeWindowEnds,
  //       tx: transaction.transactionHash,
  //     },
  //     params
  //   );
  // }
}
