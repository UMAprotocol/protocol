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
  shouldIgnoreThirdPartyProposal,
  storeNotifiedProposals,
  POLYGON_BLOCKS_PER_HOUR,
} from "./common";

// Retrieve threshold values from environment variables.
function getThresholds() {
  return {
    asks: Number(process.env["THRESHOLD_ASKS"]) || 1,
    bids: Number(process.env["THRESHOLD_BIDS"]) || 0,
    volume: Number(process.env["THRESHOLD_VOLUME"]) || 500000,
  };
}

async function processProposal(
  proposal: OptimisticPriceRequest,
  params: MonitoringParams,
  logger: typeof Logger,
  version: "v1" | "v2"
) {
  const networker = new Networker(logger);
  const isSportsMarket = proposal.requester === params.ctfSportsOracleAddress;
  const questionID = calculatePolymarketQuestionID(proposal.ancillaryData);

  // Retry fetching market information per configuration.
  let markets;
  try {
    markets = await retryAsync(
      () => getPolymarketMarketInformation(logger, params, questionID),
      params.retryAttempts,
      params.retryDelayMs
    );
  } catch (error) {
    // Check if this is the specific "No market found" error for 3rd party proposals
    if (error instanceof Error && error.message.includes(`No market found for question ID: ${questionID}`)) {
      // Apply 3rd party proposal filtering logic
      const shouldIgnore = await shouldIgnoreThirdPartyProposal(params, proposal, version);

      if (shouldIgnore) {
        // Ignore this proposal - log for debugging but don't alert
        logger.info({
          at: "PolymarketMonitor",
          message: "Ignoring 3rd party Polymarket proposal based on filtering criteria",
          questionID,
          proposalHash: proposal.proposalHash,
          requester: proposal.requester,
        });
        return { notified: false, notifiedProposal: null };
      }
      // If <2 criteria met, let the error bubble up to trigger alert
    }
    // Re-throw the error to maintain existing behavior for other error types
    throw error;
  }

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
      const sportsMarketData: Market = await getSportsMarketData(params, marketInfo.questionID);
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
    // We only want to look back fillEventsLookbackSeconds seconds, but no older than startBlockNumber
    const currentBlockNumber = await params.provider.getBlockNumber();
    const blocksPerSecond = POLYGON_BLOCKS_PER_HOUR / 3_600;
    const lookbackBlocks = Math.round(params.fillEventsLookbackSeconds * blocksPerSecond);
    const fromBlock = Math.max(Number(proposal.proposalBlockNumber), currentBlockNumber - lookbackBlocks);
    const orderFilledEvents = await getOrderFilledEvents(params, marketInfo.clobTokenIds, fromBlock);

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
  await Promise.all(
    proposals.map(async (proposal) => {
      // Skip if we have already handled this proposal
      if (Object.keys(pastNotifiedProposals).includes(getProposalKeyToStore(proposal))) {
        return;
      }

      try {
        const version: "v1" | "v2" = proposalsV2.includes(proposal) ? "v2" : "v1";
        const { notified } = await processProposal(proposal, params, logger, version);

        if (notified) {
          await storeNotifiedProposals([proposal]);
        }
      } catch (error) {
        // Log and still persist so we don’t re-process the faulty proposal
        await logFailedMarketProposalVerification(logger, params.chainId, proposal, error as Error);
        await storeNotifiedProposals([proposal]);
      }
    })
  );
  console.log("All proposals have been checked!");
}
