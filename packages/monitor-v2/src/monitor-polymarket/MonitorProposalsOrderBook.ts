import { Networker } from "@uma/financial-templates-lib";
import {
  logProposalHighVolume,
  logMarketSentimentDiscrepancy,
  logFailedMarketProposalVerification,
} from "./MonitorLogger";
import {
  Logger,
  MonitoringParams,
  ONE_SCALED,
  OptimisticPriceRequest,
  calculatePolymarketQuestionID,
  getMarketKeyToStore,
  getNotifiedProposals,
  getOrderFilledEvents,
  getPolymarketMarketInformation,
  getPolymarketOrderBook,
  getPolymarketProposedPriceRequestsOO,
  storeNotifiedProposals,
  retryAsync,
} from "./common";

export async function monitorTransactionsProposedOrderBook(
  logger: typeof Logger,
  params: MonitoringParams
): Promise<void> {
  const pastNotifiedProposals = await getNotifiedProposals();
  const polymarketRequesters = [params.ctfAdapterAddress, params.ctfAdapterAddressV2, params.binaryAdapterAddress];
  const proposedPriceRequestsOOv2 = await getPolymarketProposedPriceRequestsOO(params, "v2", polymarketRequesters);
  const proposedPriceRequestsOOv1 = await getPolymarketProposedPriceRequestsOO(params, "v1", polymarketRequesters);
  const livePolymarketProposalRequests = [...proposedPriceRequestsOOv2, ...proposedPriceRequestsOOv1];

  console.log(`Checking proposal price for ${livePolymarketProposalRequests.length} markets...`);

  const notifiedProposals = [];
  for (const market of livePolymarketProposalRequests) {
    if (Object.keys(pastNotifiedProposals).includes(getMarketKeyToStore(market))) continue;
    try {
      const processingResult = await processMarketProposal(market, params, logger);
      if (processingResult.notified) notifiedProposals.push(market);
    } catch (error) {
      await logFailedMarketProposalVerification(logger, params.chainId, market, error as Error);
      notifiedProposals.push(market);
    }
  }

  await storeNotifiedProposals(notifiedProposals);
  console.log("All proposals have been checked!");
}

async function processMarketProposal(market: OptimisticPriceRequest, params: MonitoringParams, logger: typeof Logger) {
  const networker = new Networker(logger);
  const questionID = calculatePolymarketQuestionID(market.ancillaryData);
  // set this to retry twice and wait 5 seconds between retries.
  const polymarketInfo = await retryAsync(
    () => getPolymarketMarketInformation(logger, params, questionID),
    params.retryAttempts,
    params.retryDelayMs
  );
  const orderBook = await getPolymarketOrderBook(params, polymarketInfo.clobTokenIds, networker);
  const orderFilledEvents = await getOrderFilledEvents(
    params,
    polymarketInfo.clobTokenIds,
    Number(market.requestBlockNumber)
  );

  const proposedOutcome = market.proposedPrice.eq(ONE_SCALED) ? 0 : 1;
  const complementaryOutcome = proposedOutcome === 0 ? 1 : 0;

  const thresholds = {
    asks: Number(process.env["THRESHOLD_ASKS"]) || 1,
    bids: Number(process.env["THRESHOLD_BIDS"]) || 0,
    volume: Number(process.env["THRESHOLD_VOLUME"]) || 500000,
  };

  const sellingWinnerSide = orderBook[proposedOutcome].asks.find((ask) => ask.price < thresholds.asks);
  const buyingLoserSide = orderBook[complementaryOutcome].bids.find((bid) => bid.price > thresholds.bids);

  const soldWinnerSide = orderFilledEvents[proposedOutcome].filter(
    (event) => event.type == "sell" && event.price < thresholds.asks
  );
  const boughtLoserSide = orderFilledEvents[complementaryOutcome].filter(
    (event) => event.type == "buy" && event.price > thresholds.bids
  );

  let notified = false;
  const notificationData = {
    txHash: market.proposalHash,
    question: polymarketInfo.question,
    proposedPrice: market.proposedPrice,
    requestTimestamp: market.requestTimestamp,
  };

  if (polymarketInfo.volumeNum > thresholds.volume) {
    await logProposalHighVolume(logger, { ...market, ...polymarketInfo }, params);
    notified = true;
  }

  if (sellingWinnerSide || buyingLoserSide || soldWinnerSide.length > 0 || boughtLoserSide.length > 0) {
    await logMarketSentimentDiscrepancy(
      logger,
      {
        ...market,
        ...polymarketInfo,
        sellingWinnerSide,
        buyingLoserSide,
        soldWinnerSide,
        boughtLoserSide,
      },
      params
    );
    notified = true;
  }

  return { notified, notifiedProposal: notified ? notificationData : null };
}
