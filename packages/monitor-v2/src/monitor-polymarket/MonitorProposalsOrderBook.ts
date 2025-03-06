import { Networker } from "@uma/financial-templates-lib";
import { ethers } from "ethers";
import { tryHexToUtf8String } from "../utils/contracts";
import {
  logFailedMarketProposalVerification,
  logMarketSentimentDiscrepancy,
  logProposalHighVolume,
} from "./MonitorLogger";
import {
  calculatePolymarketQuestionID,
  decodeMultipleQueryPriceAtIndex,
  decodeMultipleValuesQuery,
  getProposalKeyToStore,
  getNotifiedProposals,
  getOrderFilledEvents,
  getPolymarketMarketInformation,
  getPolymarketOrderBook,
  getPolymarketProposedPriceRequestsOO,
  getSportsMarketData,
  getSportsPayouts,
  isUnresolvable,
  Logger,
  Market,
  MonitoringParams,
  MultipleValuesQuery,
  ONE_SCALED,
  OptimisticPriceRequest,
  retryAsync,
  storeNotifiedProposals,
} from "./common";

function getThresholds() {
  return {
    asks: Number(process.env["THRESHOLD_ASKS"]) || 1,
    bids: Number(process.env["THRESHOLD_BIDS"]) || 0,
    volume: Number(process.env["THRESHOLD_VOLUME"]) || 500000,
  };
}

async function processProposal(proposal: OptimisticPriceRequest, params: MonitoringParams, logger: typeof Logger) {
  const networker = new Networker(logger);
  const isSportsMarket = proposal.requester === params.ctfSportsOracleAddress;
  const questionID = calculatePolymarketQuestionID(proposal.ancillaryData);

  // Retry fetching market information per configuration.
  const polymarketMarkets = await retryAsync(
    () => getPolymarketMarketInformation(logger, params, questionID),
    params.retryAttempts,
    params.retryDelayMs
  );

  return await Promise.all(
    polymarketMarkets.map(async (polymarketInfo) => {
      // Initialize default values.
      let scores: [ethers.BigNumber, ethers.BigNumber] = [ethers.BigNumber.from(0), ethers.BigNumber.from(0)];
      let multipleValuesQuery: MultipleValuesQuery | undefined;
      let winnerOutcome: number;
      let loserOutcome: number;

      if (isSportsMarket) {
        // If the proposed price is unresolvable, skip further processing.
        if (isUnresolvable(proposal.proposedPrice)) {
          return { notified: false, notifiedProposal: null };
        }
        const sportsMarketData: Market = await getSportsMarketData(params, questionID);
        scores = [
          decodeMultipleQueryPriceAtIndex(proposal.proposedPrice, 0),
          decodeMultipleQueryPriceAtIndex(proposal.proposedPrice, 1),
        ];
        multipleValuesQuery = decodeMultipleValuesQuery(tryHexToUtf8String(proposal.ancillaryData));
        const payouts = getSportsPayouts(sportsMarketData, proposal.proposedPrice);

        // Draws are not supported.
        if (payouts[0] === payouts[1]) {
          return { notified: false, notifiedProposal: null };
        }
        // Determine winning and losing outcomes.
        winnerOutcome = payouts[0] === 1 ? 0 : 1;
        loserOutcome = payouts[0] === 1 ? 1 : 0;
      } else {
        winnerOutcome = proposal.proposedPrice.eq(ONE_SCALED) ? 0 : 1;
        loserOutcome = winnerOutcome === 0 ? 1 : 0;
      }

      const thresholds = getThresholds();
      const orderBook = await getPolymarketOrderBook(params, polymarketInfo.clobTokenIds, networker);
      const orderFilledEvents = await getOrderFilledEvents(
        params,
        polymarketInfo.clobTokenIds,
        Number(proposal.requestBlockNumber)
      );

      // Check for concerning signals in the order book and filled events.
      const sellingWinnerSide = orderBook[winnerOutcome].asks.find((ask) => ask.price < thresholds.asks);
      const buyingLoserSide = orderBook[loserOutcome].bids.find((bid) => bid.price > thresholds.bids);
      const soldWinnerSide = orderFilledEvents[winnerOutcome].filter(
        (event) => event.type === "sell" && event.price < thresholds.asks
      );
      const boughtLoserSide = orderFilledEvents[loserOutcome].filter(
        (event) => event.type === "buy" && event.price > thresholds.bids
      );

      let notified = false;
      const notificationData = {
        txHash: proposal.proposalHash,
        question: polymarketInfo.question,
        proposedPrice: proposal.proposedPrice,
        requestTimestamp: proposal.requestTimestamp,
      };

      // Log high volume proposals.
      if (polymarketInfo.volumeNum > thresholds.volume) {
        await logProposalHighVolume(
          logger,
          { ...proposal, ...polymarketInfo, scores, multipleValuesQuery, isSportsMarket },
          params
        );
        notified = true;
      }

      // Log market sentiment discrepancies.
      if (sellingWinnerSide || buyingLoserSide || soldWinnerSide.length > 0 || boughtLoserSide.length > 0) {
        await logMarketSentimentDiscrepancy(
          logger,
          {
            ...proposal,
            ...polymarketInfo,
            sellingWinnerSide,
            buyingLoserSide,
            soldWinnerSide,
            boughtLoserSide,
            scores,
            multipleValuesQuery,
            isSportsMarket,
          },
          params
        );
        notified = true;
      }

      return { notified, notifiedProposal: notified ? notificationData : null };
    })
  );
}

export async function monitorTransactionsProposedOrderBook(
  logger: typeof Logger,
  params: MonitoringParams
): Promise<void> {
  const pastNotifiedProposals = await getNotifiedProposals();
  const polymarketRequesters = [
    params.ctfAdapterAddress,
    params.ctfAdapterAddressV2,
    params.binaryAdapterAddress,
    params.ctfSportsOracleAddress,
  ];

  // Retrieve proposals from both v2 and v1, then merge the results.
  const proposedPriceRequestsOOv2 = await getPolymarketProposedPriceRequestsOO(params, "v2", polymarketRequesters);
  const proposedPriceRequestsOOv1 = await getPolymarketProposedPriceRequestsOO(params, "v1", polymarketRequesters);
  const livePolymarketProposalRequests = [...proposedPriceRequestsOOv2, ...proposedPriceRequestsOOv1];

  console.log(`Checking proposal price for ${livePolymarketProposalRequests.length} markets...`);
  const notifiedProposals = [];

  for (const proposal of livePolymarketProposalRequests) {
    // Skip proposals that have already been notified.
    if (Object.keys(pastNotifiedProposals).includes(getProposalKeyToStore(proposal))) continue;

    try {
      const processingResults = await processProposal(proposal, params, logger);
      for (const result of processingResults) {
        if (result.notified) {
          notifiedProposals.push(proposal);
          break; // A single proposal can have multiple markets, we only notify once.
        }
      }
    } catch (error) {
      await logFailedMarketProposalVerification(logger, params.chainId, proposal, error as Error);
      notifiedProposals.push(proposal);
    }
  }

  await storeNotifiedProposals(notifiedProposals);
  console.log("All proposals have been checked!");
}
