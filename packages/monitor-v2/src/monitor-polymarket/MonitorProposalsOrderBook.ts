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

// Retrieve threshold values from environment variables.
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
  const markets = await retryAsync(
    () => getPolymarketMarketInformation(logger, params, questionID),
    params.retryAttempts,
    params.retryDelayMs
  );

  for (const marketInfo of markets) {
    let scores: [ethers.BigNumber, ethers.BigNumber] = [ethers.BigNumber.from(0), ethers.BigNumber.from(0)];
    let multipleValuesQuery: MultipleValuesQuery | undefined;
    let winnerOutcome: number;
    let loserOutcome: number;

    if (isSportsMarket) {
      // Skip if the proposed price is unresolvable.
      if (isUnresolvable(proposal.proposedPrice)) {
        continue;
      }

      // Process sports-specific market data.
      const sportsMarketData: Market = await getSportsMarketData(params, questionID);
      scores = [
        decodeMultipleQueryPriceAtIndex(proposal.proposedPrice, 0),
        decodeMultipleQueryPriceAtIndex(proposal.proposedPrice, 1),
      ];
      multipleValuesQuery = decodeMultipleValuesQuery(tryHexToUtf8String(proposal.ancillaryData));
      const payouts = getSportsPayouts(sportsMarketData, proposal.proposedPrice);

      // If both payouts are equal (a draw), skip further processing.
      if (payouts[0] === payouts[1]) {
        continue;
      }
      winnerOutcome = payouts[0] === 1 ? 0 : 1;
      loserOutcome = 1 - winnerOutcome;
    } else {
      // Non-sports market logic.
      // Ignore unresolvable prices where the orderbook doesn't provide relevant information.
      if (!proposal.proposedPrice.eq(ethers.BigNumber.from(0)) && !proposal.proposedPrice.eq(ONE_SCALED)) {
        continue;
      }
      winnerOutcome = proposal.proposedPrice.eq(ONE_SCALED) ? 0 : 1;
      loserOutcome = 1 - winnerOutcome;
    }

    const thresholds = getThresholds();
    const orderBook = await getPolymarketOrderBook(params, marketInfo.clobTokenIds, networker);
    const orderFilledEvents = await getOrderFilledEvents(
      params,
      marketInfo.clobTokenIds,
      Number(proposal.requestBlockNumber)
    );

    // Check the order book for concerning signals.
    const sellingWinnerSide = orderBook[winnerOutcome].asks.find((ask) => ask.price < thresholds.asks);
    const buyingLoserSide = orderBook[loserOutcome].bids.find((bid) => bid.price > thresholds.bids);
    const soldWinnerSide = orderFilledEvents[winnerOutcome].filter(
      (event) => event.type === "sell" && event.price < thresholds.asks
    );
    const boughtLoserSide = orderFilledEvents[loserOutcome].filter(
      (event) => event.type === "buy" && event.price > thresholds.bids
    );

    let notified = false;

    // Log high volume proposals.
    if (marketInfo.volumeNum > thresholds.volume) {
      await logProposalHighVolume(
        logger,
        { ...proposal, ...marketInfo, scores, multipleValuesQuery, isSportsMarket },
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
          ...marketInfo,
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

    if (notified) {
      return {
        notified,
        notifiedProposal: {
          txHash: proposal.proposalHash,
          question: marketInfo.question,
          proposedPrice: proposal.proposedPrice,
          requestTimestamp: proposal.requestTimestamp,
        },
      };
    }
  }
  return { notified: false, notifiedProposal: null };
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

  // Merge proposals from v2 and v1.
  const proposalsV2 = await getPolymarketProposedPriceRequestsOO(params, "v2", polymarketRequesters);
  const proposalsV1 = await getPolymarketProposedPriceRequestsOO(params, "v1", polymarketRequesters);
  const proposals = [...proposalsV2, ...proposalsV1];

  console.log(`Checking proposal price for ${proposals.length} markets...`);
  const notifiedProposals = [];

  for (const proposal of proposals) {
    // Skip proposals that have already been processed.
    if (Object.keys(pastNotifiedProposals).includes(getProposalKeyToStore(proposal))) {
      continue;
    }

    try {
      const { notified } = await processProposal(proposal, params, logger);
      if (notified) {
        notifiedProposals.push(proposal);
      }
    } catch (error) {
      await logFailedMarketProposalVerification(logger, params.chainId, proposal, error as Error);
      notifiedProposals.push(proposal);
    }
  }

  await storeNotifiedProposals(notifiedProposals);
  console.log("All proposals have been checked!");
}
