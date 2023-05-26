import { OptimisticOracleEthers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { Networker } from "@uma/financial-templates-lib";
import { paginatedEventQuery } from "@uma/common";
import {
  Logger,
  MonitoringParams,
  PolymarketWithEventData,
  YES_OR_NO_QUERY,
  formatPriceEvents,
  getContractInstanceWithProvider,
  getMarketKeyToStore,
  getMarketsAncillary,
  getNotifiedProposals,
  getOrderFilledEvents,
  getPolymarketMarkets,
  getPolymarketOrderBooks,
  storeNotifiedProposals,
} from "./common";
import { logProposalHighVolume, logProposalOrderBook } from "./MonitorLogger";

export async function monitorTransactionsProposedOrderBook(
  logger: typeof Logger,
  params: MonitoringParams
): Promise<void> {
  const networker = new Networker(logger);
  const currentBlockNumber = await params.provider.getBlockNumber();

  const pastNotifiedProposals = await getNotifiedProposals();

  const daysToLookup = 1; // This bot only looks back 1 day for proposals.

  // These values are hardcoded for the Polygon network as this bot is only intended to run on Polygon.
  const maxBlockLookBack = params.maxBlockLookBack;
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
    .filter((market) =>
      proposalEvents.find(
        (event) =>
          event.ancillaryData === market.ancillaryData &&
          event.timestamp === market.requestTimestamp &&
          event.identifier === YES_OR_NO_QUERY
      )
    )
    .map((market) => {
      const event = proposalEvents.find(
        (event) =>
          event.ancillaryData === market.ancillaryData &&
          event.timestamp === market.requestTimestamp &&
          event.identifier === YES_OR_NO_QUERY
      );
      if (!event) throw new Error("Could not find event for market");
      return {
        ...market,
        ...event,
      };
    })
    .filter((market) => market.expirationTimestamp > Date.now() / 1000)
    .filter((market) => !Object.keys(pastNotifiedProposals).includes(getMarketKeyToStore(market)));

  // Get live order books for markets that have a proposal event.
  const marketsWithOrderBooks = await getPolymarketOrderBooks(params, marketsWithEventData, networker);

  // Get trades that have occurred since the proposal event
  const marketsWithOrderBooksAndTrades = await getOrderFilledEvents(params, marketsWithOrderBooks);

  const notifiedProposals = [];
  console.log(`Checking proposal price for ${marketsWithOrderBooks.length} markets...`);
  for (const market of marketsWithOrderBooksAndTrades) {
    const proposedOutcome = market.proposedPrice === "1.0" ? 0 : 1;
    const complementaryOutcome = proposedOutcome === 0 ? 1 : 0;
    const thresholdAsks = Number(process.env["THRESHOLD_ASKS"]) || 1;
    const thresholdBids = Number(process.env["THRESHOLD_BIDS"]) || 0;
    const thresholdVolume = Number(process.env["THRESHOLD_VOLUME"]) || 500000;

    const sellingWinnerSide = market.orderBooks[proposedOutcome].asks.find((ask) => ask.price < thresholdAsks);
    const buyingLoserSide = market.orderBooks[complementaryOutcome].bids.find((bid) => bid.price > thresholdBids);

    const soldWinnerSide = market.orderFilledEvents[proposedOutcome].filter(
      (event) => event.type == "sell" && event.price < thresholdAsks
    );
    const boughtLoserSide = market.orderFilledEvents[complementaryOutcome].filter(
      (event) => event.type == "buy" && event.price > thresholdBids
    );
    let notified = false;
    if (market.volumeNum > thresholdVolume) {
      await logProposalHighVolume(
        logger,
        {
          proposedPrice: market.proposedPrice,
          proposedOutcome: market.outcomes[proposedOutcome],
          proposalTime: market.proposalTimestamp,
          question: market.question,
          tx: market.txHash,
          volumeNum: market.volumeNum,
          outcomes: market.outcomes,
          expirationTimestamp: market.expirationTimestamp,
          eventIndex: market.eventIndex,
        },
        params
      );
      if (!notified) {
        notified = true;
        notifiedProposals.push(market);
      }
    }

    if (sellingWinnerSide || buyingLoserSide || soldWinnerSide.length > 0 || boughtLoserSide.length > 0) {
      await logProposalOrderBook(
        logger,
        {
          proposedPrice: market.proposedPrice,
          proposedOutcome: market.outcomes[proposedOutcome],
          proposalTime: market.proposalTimestamp,
          question: market.question,
          tx: market.txHash,
          sellingWinnerSide,
          buyingLoserSide,
          soldWinnerSide,
          boughtLoserSide,
          outcomes: market.outcomes,
          expirationTimestamp: market.expirationTimestamp,
          eventIndex: market.eventIndex,
        },
        params
      );
      if (!notified) {
        notified = true;
        notifiedProposals.push(market);
      }
    }
  }
  await storeNotifiedProposals(notifiedProposals);

  console.log("All proposals have been checked!");
}
