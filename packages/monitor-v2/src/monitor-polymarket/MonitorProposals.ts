import { OptimisticOracleEthers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { Networker } from "@uma/financial-templates-lib";
import { paginatedEventQuery } from "../utils/EventUtils";
import {
  formatPriceEvents,
  getContractInstanceWithProvider,
  getMarketsAncillary,
  getMarketsHistoricPrices,
  getOrderFilledEvents,
  getPolymarketMarkets,
  Logger,
  MonitoringParams,
  PolymarketWithEventData,
} from "./common";
import { logProposal } from "./MonitorLogger";

export async function monitorTransactionsProposed(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const networker = new Networker(logger);
  const currentBlockNumber = await params.provider.getBlockNumber();

  const daysToLookup = 1; // This bot only looks back 1 day for proposals.

  // These values are hardcoded for the Polygon network as this bot is only intended to run on Polygon.
  const maxBlockLookBack = 3499; // Polygons max block look back is 3499 blocks.
  const blockLookup = 43200 * daysToLookup; // 1 day in blocks on Polygon is 43200 blocks.

  const searchConfig = {
    fromBlock: currentBlockNumber - blockLookup < 0 ? 0 : currentBlockNumber - blockLookup,
    toBlock: currentBlockNumber,
    maxBlockLookBack,
  };

  const oo = await getContractInstanceWithProvider<OptimisticOracleEthers>("OptimisticOracle", params.provider);
  const oov2 = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>("OptimisticOracleV2", params.provider);

  const eventsOo = await paginatedEventQuery<ProposePriceEvent>(oo, oo.filters.ProposePrice(), searchConfig);
  const eventsOov2 = await paginatedEventQuery<ProposePriceEvent>(oov2, oov2.filters.ProposePrice(), searchConfig);
  // Merge the events from both OO versions.
  const proposalEvents = await formatPriceEvents([...eventsOo, ...eventsOov2]);

  const markets = await getPolymarketMarkets(params);
  const marketsWithAncillary = await getMarketsAncillary(params, markets);

  // Filter out markets that do not have a proposal event.
  const marketsWithEventData: PolymarketWithEventData[] = marketsWithAncillary
    .filter((market) => proposalEvents.find((event) => event.ancillaryData === market.ancillaryData))
    .map((market) => {
      const event = proposalEvents.find((event) => event.ancillaryData === market.ancillaryData);
      if (!event) throw new Error("Could not find event for market");
      return {
        ...market,
        ...event,
      };
    });

  // Add the historic orderbook signals to the markets and calculate the trade signals.
  const marketsWithHistory = await getMarketsHistoricPrices(params, marketsWithEventData, networker);

  // Add the order filled events to the markets and calculate the trade signals.
  const marketsWithOrderFilled = await getOrderFilledEvents(params, marketsWithHistory);

  for (const market of marketsWithOrderFilled) {
    const proposedOutcome = market.proposedPrice == "1.0" ? 0 : 1;
    const threshold = 0.75;
    const thresholdHistoric = 0.8;
    const tradeSignal = market.tradeSignals[proposedOutcome] > 0 && market.tradeSignals[proposedOutcome] < threshold;
    const historicOrderbookSignal =
      market.historicOrderBookSignals[proposedOutcome] > 0 &&
      market.historicOrderBookSignals[proposedOutcome] < thresholdHistoric;
    if (tradeSignal || historicOrderbookSignal) {
      logProposal(
        logger,
        {
          proposedPrice: market.proposedPrice,
          proposedOutcome: market.outcomes[proposedOutcome],
          proposalTime: market.proposalTimestamp,
          question: market.question,
          tx: market.txHash,
          tradeSignals: market.tradeSignals,
          historicOrderbookSignals: market.historicOrderBookSignals,
          outcomes: market.outcomes,
          expirationTimestamp: market.expirationTimestamp,
          eventIndex: market.eventIndex,
        },
        params
      );
    }
  }
}
