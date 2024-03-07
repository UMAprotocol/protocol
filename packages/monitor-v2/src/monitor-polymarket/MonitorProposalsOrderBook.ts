import { Networker } from "@uma/financial-templates-lib";
import { ethers } from "ethers";
import { logProposalHighVolume, logProposalOrderBook, logUnknownMarketProposal } from "./MonitorLogger";
import {
  Logger,
  MonitoringParams,
  findPolymarketQuestionIDs,
  getOrderFilledEvents,
  getPolymarketMarketInformation,
  getPolymarketOrderBook,
  getProposedPriceRequestsOO,
  storeNotifiedProposals,
} from "./common";

export const tryHexToUtf8String = (ancillaryData: string): string => {
  try {
    return ethers.utils.toUtf8String(ancillaryData);
  } catch (err) {
    return ancillaryData;
  }
};

export async function monitorTransactionsProposedOrderBook(
  logger: typeof Logger,
  params: MonitoringParams
): Promise<void> {
  const networker = new Networker(logger);

  const proposedPriceRequestsOOv2 = await getProposedPriceRequestsOO("v2");
  const proposedPriceRequestsOOv1 = await getProposedPriceRequestsOO("v1");

  const liveProposalRequests = [...proposedPriceRequestsOOv1, ...proposedPriceRequestsOOv2];

  const notifiedProposals = [];

  // Find the polymarket question IDs for the proposal events
  const { found: polymarketMarketsProposals, notFound } = await findPolymarketQuestionIDs(params, liveProposalRequests);

  if (notFound.length > 0) {
    for (const market of notFound) {
      logUnknownMarketProposal(logger, params.chainId, market);
      notifiedProposals.push({
        txHash: market.proposalHash,
        question: "Unknown",
        proposedPrice: market.proposedPrice,
        requestTimestamp: market.requestTimestamp,
      });
    }
  }

  // Get Polymarket info for each market
  const pm = await Promise.all(
    polymarketMarketsProposals.map((market) => getPolymarketMarketInformation(params, market.questionID))
  );

  // Get live order books for markets that have a proposal event.
  const marketsOrderbooks = await Promise.all(pm.map((p) => getPolymarketOrderBook(params, p.clobTokenIds, networker)));

  // Get trades that have occurred since the proposal event
  const marketsOrderFilledEvents = await Promise.all(
    polymarketMarketsProposals.map((market, i) =>
      getOrderFilledEvents(params, pm[i].clobTokenIds, Number(market.requestBlockNumber))
    )
  );

  console.log(`Checking proposal price for ${polymarketMarketsProposals.length} markets...`);
  for (let i = 0; i < polymarketMarketsProposals.length; i++) {
    const market = polymarketMarketsProposals[i];
    const polymarketInfo = pm[i];
    const orderBook = marketsOrderbooks[i];
    const orderFilledEvents = marketsOrderFilledEvents[i];
    const proposedOutcome = market.proposedPrice === "1.0" ? 0 : 1;
    const complementaryOutcome = proposedOutcome === 0 ? 1 : 0;
    const thresholdAsks = Number(process.env["THRESHOLD_ASKS"]) || 1;
    const thresholdBids = Number(process.env["THRESHOLD_BIDS"]) || 0;
    const thresholdVolume = Number(process.env["THRESHOLD_VOLUME"]) || 500000;

    const sellingWinnerSide = orderBook[proposedOutcome].asks.find((ask) => ask.price < thresholdAsks);
    const buyingLoserSide = orderBook[complementaryOutcome].bids.find((bid) => bid.price > thresholdBids);

    const soldWinnerSide = orderFilledEvents[proposedOutcome].filter(
      (event) => event.type == "sell" && event.price < thresholdAsks
    );
    const boughtLoserSide = orderFilledEvents[complementaryOutcome].filter(
      (event) => event.type == "buy" && event.price > thresholdBids
    );
    let notified = false;
    if (polymarketInfo.volumeNum > thresholdVolume) {
      await logProposalHighVolume(
        logger,
        {
          proposedPrice: market.proposedPrice,
          proposedOutcome: polymarketInfo.outcomes[proposedOutcome],
          proposalTime: market.proposalTimestamp,
          question: polymarketInfo.question,
          tx: market.proposalHash,
          volumeNum: polymarketInfo.volumeNum,
          outcomes: polymarketInfo.outcomes,
          expirationTimestamp: market.proposalExpirationTimestamp,
          eventIndex: market.proposalLogIndex,
        },
        params
      );
      if (!notified) {
        notified = true;
        notifiedProposals.push({
          txHash: market.proposalHash,
          question: polymarketInfo.question,
          proposedPrice: market.proposedPrice,
          requestTimestamp: market.requestTimestamp,
        });
      }
    }

    if (sellingWinnerSide || buyingLoserSide || soldWinnerSide.length > 0 || boughtLoserSide.length > 0) {
      await logProposalOrderBook(
        logger,
        {
          proposedPrice: market.proposedPrice,
          proposedOutcome: polymarketInfo.outcomes[proposedOutcome],
          proposalTime: market.proposalTimestamp,
          question: polymarketInfo.question,
          tx: market.proposalHash,
          sellingWinnerSide,
          buyingLoserSide,
          soldWinnerSide,
          boughtLoserSide,
          outcomes: polymarketInfo.outcomes,
          expirationTimestamp: market.proposalExpirationTimestamp,
          eventIndex: market.proposalLogIndex,
        },
        params
      );
      if (!notified) {
        notified = true;
        notifiedProposals.push({
          txHash: market.proposalHash,
          question: polymarketInfo.question,
          proposedPrice: market.proposedPrice,
          requestTimestamp: market.requestTimestamp,
        });
      }
    }
  }
  await storeNotifiedProposals(notifiedProposals);

  console.log("All proposals have been checked!");
}
