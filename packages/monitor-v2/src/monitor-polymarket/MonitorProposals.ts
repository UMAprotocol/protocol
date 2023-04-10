import { OptimisticOracleEthers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { Networker } from "@uma/financial-templates-lib";
import { paginatedEventQuery } from "../utils/EventUtils";
import {
  formatPriceEvents,
  getContractInstanceWithProvider,
  getMarketsAncillary,
  getMarketsHistoricPrices,
  getNotifiedProposals,
  getOrderFilledEvents,
  getPolymarketMarkets,
  Logger,
  MonitoringParams,
  PolymarketWithEventData,
  storeNotifiedProposals,
  getMarketKeyToStore,
} from "./common";
import { logProposal } from "./MonitorLogger";

export async function monitorTransactionsProposed(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  const networker = new Networker(logger);
  const currentBlockNumber = await params.provider.getBlockNumber();

  const pastNotifiedProposals = await getNotifiedProposals();

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
    })
    .filter((market) => market.expirationTimestamp > Date.now() / 1000)
    .filter((market) => !Object.keys(pastNotifiedProposals).includes(getMarketKeyToStore(market)));

  // Add the historic orderbook signals to the markets and calculate the trade signals.
  const marketsWithHistory = await getMarketsHistoricPrices(params, marketsWithEventData, networker);

  // Add the order filled events to the markets and calculate the trade signals.
  const marketsWithOrderFilled = await getOrderFilledEvents(params, marketsWithHistory);

  const shouldNotify = (
    efficiencyProposed: number,
    signalProposed: number,
    efficiencyComplentary: number,
    signalComplementary: number,
    threshold: number
  ) =>
    (efficiencyProposed > 0 && signalProposed < threshold * efficiencyProposed) ||
    (efficiencyComplentary > 0 && signalComplementary > 1 - threshold * efficiencyComplentary);

  const notifiedProposals = [];
  for (const market of marketsWithOrderFilled) {
    const proposedOutcome = market.proposedPrice == "1.0" ? 0 : 1;
    const complementaryOutcome = proposedOutcome === 0 ? 1 : 0;
    const thresholdTrades = Number(process.env["THRESHOLD_TRADES"]) || 0.9;
    const thresholdOrders = Number(process.env["THRESHOLD_ORDERS"]) || 0.9;
    const tradeSignal = shouldNotify(
      market.tradeSignalsEfficiency[proposedOutcome],
      market.tradeSignals[proposedOutcome],
      market.tradeSignalsEfficiency[complementaryOutcome],
      market.tradeSignals[complementaryOutcome],
      thresholdTrades
    );
    const historicOrderbookSignal = shouldNotify(
      market.historicOrderBookSignalsEfficiency[proposedOutcome],
      market.historicOrderBookSignals[proposedOutcome],
      market.historicOrderBookSignalsEfficiency[complementaryOutcome],
      market.historicOrderBookSignals[complementaryOutcome],
      thresholdOrders
    );

    if (tradeSignal || historicOrderbookSignal) {
      await logProposal(
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
      notifiedProposals.push(market);
    }
  }
  await storeNotifiedProposals(notifiedProposals);
}
