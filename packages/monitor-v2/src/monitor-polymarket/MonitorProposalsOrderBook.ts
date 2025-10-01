import { ethers } from "ethers";
import { tryHexToUtf8String } from "../utils/contracts";
import {
  logFailedMarketProposalVerification,
  logMarketSentimentDiscrepancy,
  logProposalHighVolume,
  logProposalAlignmentConfirmed,
} from "./MonitorLogger";
import {
  calculatePolymarketQuestionID,
  decodeMultipleQueryPriceAtIndex,
  decodeMultipleValuesQuery,
  getNotifiedProposals,
  getOrderFilledEvents,
  getPolymarketMarketInformation,
  getPolymarketOrderBook,
  getPolymarketOrderBooks,
  getPolymarketProposedPriceRequestsOO,
  getProposalKeyToStore,
  getSportsMarketData,
  getSportsPayouts,
  isUnresolvable,
  isProposalNotified,
  ONE_SCALED,
  POLYGON_BLOCKS_PER_HOUR,
  shouldIgnoreThirdPartyProposal,
  storeNotifiedProposals,
  Logger,
  Market,
  MarketOrderbook,
  MonitoringParams,
  MultipleValuesQuery,
  OptimisticPriceRequest,
  PolymarketMarketGraphqlProcessed,
  isInitialConfirmationLogged,
  fetchLatestAIDeepLink,
} from "./common";
import * as common from "./common";

// Retrieve threshold values from environment variables.
function getThresholds() {
  return {
    asks: Number(process.env["THRESHOLD_ASKS"]) || 1,
    bids: Number(process.env["THRESHOLD_BIDS"]) || 0,
    volume: Number(process.env["THRESHOLD_VOLUME"]) || 500_000,
  };
}

const blocksPerSecond = POLYGON_BLOCKS_PER_HOUR / 3_600;

function outcomeIndexes(
  isSportsMarket: boolean,
  proposal: OptimisticPriceRequest,
  sportsMarket?: Market
): { winner: number; loser: number; scores: [ethers.BigNumber, ethers.BigNumber]; mvq?: MultipleValuesQuery } {
  if (isSportsMarket) {
    if (isUnresolvable(proposal.proposedPrice))
      return { winner: -1, loser: -1, scores: [ethers.constants.Zero, ethers.constants.Zero] };

    const scores: [ethers.BigNumber, ethers.BigNumber] = [
      decodeMultipleQueryPriceAtIndex(proposal.proposedPrice, 0),
      decodeMultipleQueryPriceAtIndex(proposal.proposedPrice, 1),
    ];
    const payouts = getSportsPayouts(sportsMarket!, proposal.proposedPrice);
    if (payouts[0] === payouts[1]) return { winner: -1, loser: -1, scores };

    const winner = payouts[0] === 1 ? 0 : 1;
    return {
      winner,
      loser: 1 - winner,
      scores,
      mvq: decodeMultipleValuesQuery(tryHexToUtf8String(proposal.ancillaryData)),
    };
  }

  // Non-sports market logic.
  // Ignore unresolvable prices where the orderbook doesn't provide relevant information.
  if (!proposal.proposedPrice.eq(ethers.BigNumber.from(0)) && !proposal.proposedPrice.eq(ONE_SCALED)) {
    return { winner: -1, loser: -1, scores: [ethers.constants.Zero, ethers.constants.Zero] }; // unresolvable
  }
  const winner = proposal.proposedPrice.eq(ONE_SCALED) ? 0 : 1;
  return { winner, loser: 1 - winner, scores: [ethers.constants.Zero, ethers.constants.Zero] };
}

const persistNotified = async (proposal: OptimisticPriceRequest, logger: typeof Logger) =>
  storeNotifiedProposals([proposal]).catch(() =>
    logger.error({
      at: "PolymarketMonitor",
      message: "Failed to persist notified proposal",
      proposal,
    })
  );

export async function processProposal(
  proposal: OptimisticPriceRequest,
  markets: PolymarketMarketGraphqlProcessed[],
  orderbooks: Record<string, MarketOrderbook>,
  params: MonitoringParams,
  logger: typeof Logger
): Promise<boolean /* notified */> {
  const thresholds = getThresholds();
  const isSportsRequest = proposal.requester === params.ctfSportsOracleAddress;

  const currentBlock = await params.provider.getBlockNumber();
  const lookbackBlocks = Math.round(params.fillEventsLookbackSeconds * blocksPerSecond);
  const gapBlocks = Math.round(params.fillEventsProposalGapSeconds * blocksPerSecond);
  const proposalGapStartBlock = Number(proposal.proposalBlockNumber) + gapBlocks;

  const checkMarket = async (market: PolymarketMarketGraphqlProcessed): Promise<boolean> => {
    const outcome = isSportsRequest
      ? outcomeIndexes(true, proposal, await getSportsMarketData(params, market.questionID))
      : outcomeIndexes(false, proposal);

    if (outcome.winner === -1) return false; // draw / unresolvable

    const books: [MarketOrderbook, MarketOrderbook] = [
      orderbooks[market.clobTokenIds[0]],
      orderbooks[market.clobTokenIds[1]],
    ];

    const sellingWinnerSide = books[outcome.winner].asks.find((a) => a.price < thresholds.asks);
    const buyingLoserSide = books[outcome.loser].bids.find((b) => b.price > thresholds.bids);

    const fromBlock = Math.max(proposalGapStartBlock, currentBlock - lookbackBlocks);
    const fills = await getOrderFilledEvents(params, market.clobTokenIds, fromBlock);

    const soldWinner = fills[outcome.winner].filter((f) => f.type === "sell" && f.price < thresholds.asks);
    const boughtLoser = fills[outcome.loser].filter((f) => f.type === "buy" && f.price > thresholds.bids);

    const { deeplink: aiDeeplink } = await fetchLatestAIDeepLink(proposal, params, logger);

    let alerted = false;

    const alreadyNotified = await isProposalNotified(proposal);
    if (!alreadyNotified && market.volumeNum > thresholds.volume) {
      await logProposalHighVolume(
        logger,
        {
          ...proposal,
          ...market,
          scores: outcome.scores,
          multipleValuesQuery: outcome.mvq,
          isSportsMarket: isSportsRequest,
          aiDeeplink,
        },
        params
      );
      await persistNotified(proposal, logger);
      alerted = true;
    }

    const hasDiscrepancy = Boolean(sellingWinnerSide || buyingLoserSide || soldWinner.length || boughtLoser.length);

    if (!alreadyNotified && hasDiscrepancy) {
      await logMarketSentimentDiscrepancy(
        logger,
        {
          ...proposal,
          ...market,
          sellingWinnerSide,
          buyingLoserSide,
          soldWinnerSide: soldWinner,
          boughtLoserSide: boughtLoser,
          scores: outcome.scores,
          multipleValuesQuery: outcome.mvq,
          isSportsMarket: isSportsRequest,
          aiDeeplink,
        },
        params
      );
      await persistNotified(proposal, logger);
      alerted = true;
    }

    if (!hasDiscrepancy && !alerted) {
      const alreadyLogged = await isInitialConfirmationLogged(market.questionID);

      if (!alreadyLogged) {
        await logProposalAlignmentConfirmed(
          logger,
          {
            ...proposal,
            ...market,
            scores: outcome.scores,
            multipleValuesQuery: outcome.mvq,
            isSportsMarket: isSportsRequest,
            aiDeeplink,
          },
          params
        );

        await common.markInitialConfirmationLogged(market.questionID);
      }
    }

    return alerted;
  };

  const marketPromises = markets.map(checkMarket);

  // Execute all market checks concurrently; Promise.any resolves when one returns true and throws if all return false.
  try {
    await Promise.any(marketPromises.map((proposal) => proposal.then((ok) => (ok ? true : Promise.reject()))));
    return true; // at least one market alerted
  } catch {
    return false; // none of the markets alerted
  }
}

export async function monitorTransactionsProposedOrderBook(
  logger: typeof Logger,
  params: MonitoringParams
): Promise<void> {
  const notifiedKeys = new Set(Object.keys(await getNotifiedProposals()));
  const requesters = [params.ctfSportsOracleAddress, ...(params.additionalRequesters ?? [])];

  const ooV2Promises = params.ooV2Addresses.map((ooV2Address) =>
    getPolymarketProposedPriceRequestsOO(params, "v2", requesters, ooV2Address)
  );
  const ooV1Promises = params.ooV1Addresses.map((ooV1Address) =>
    getPolymarketProposedPriceRequestsOO(params, "v1", requesters, ooV1Address)
  );
  // Merge proposals from v2 and v1.
  const [v2, v1] = await Promise.all([
    Promise.all(ooV2Promises).then((e) => e.flat()),
    Promise.all(ooV1Promises).then((e) => e.flat()),
  ]);

  const allProposals = [
    ...v2.map((proposal) => ({ proposal, version: "v2" as const })),
    ...v1.map((proposal) => ({ proposal, version: "v1" as const })),
  ] //
    .filter(({ proposal }) => !notifiedKeys.has(getProposalKeyToStore(proposal)));

  // Build bundles of proposals and their markets.
  const bundles: {
    proposal: OptimisticPriceRequest;
    markets: PolymarketMarketGraphqlProcessed[];
  }[] = [];
  const tokenIds = new Set<string>();

  const logErrorAndPersist = async (proposal: OptimisticPriceRequest, err: Error) => {
    const { deeplink: aiDeeplink } = await fetchLatestAIDeepLink(proposal, params, logger);
    await logFailedMarketProposalVerification(logger, params.chainId, proposal, err as Error, aiDeeplink);
    await persistNotified(proposal, logger);
  };

  await Promise.all(
    allProposals.map(async ({ proposal, version }) => {
      const questionID = calculatePolymarketQuestionID(proposal.ancillaryData);

      try {
        const markets = await getPolymarketMarketInformation(logger, params, questionID);
        markets.forEach((market) => {
          tokenIds.add(market.clobTokenIds[0]);
          tokenIds.add(market.clobTokenIds[1]);
        });
        bundles.push({ proposal, markets });
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
            return;
          }
        }
        // If <2 criteria met, let the error bubble up to trigger alert
        await logErrorAndPersist(proposal, error as Error);
      }
    })
  );

  let orderbookMap: Record<string, MarketOrderbook> = {};
  let activeBundles = bundles; // may shrink below

  try {
    // Fast path: single batched request
    orderbookMap = await getPolymarketOrderBooks(params, [...tokenIds]);
  } catch (bulkErr) {
    logger.warn({
      at: "PolymarketMonitor",
      message: "Bulk order-book fetch failed – falling back to per-market fetches",
      error: bulkErr,
    });

    const survivingBundles: typeof bundles = [];

    // Fetch each market's orderbook individually
    await Promise.all(
      bundles.map(async (bundle) => {
        try {
          for (const market of bundle.markets) {
            const [book0, book1] = await getPolymarketOrderBook(params, market.clobTokenIds as [string, string]);
            orderbookMap[market.clobTokenIds[0]] = book0;
            orderbookMap[market.clobTokenIds[1]] = book1;
          }
          survivingBundles.push(bundle);
        } catch (pairErr) {
          await logErrorAndPersist(bundle.proposal, pairErr as Error);
        }
      })
    );

    activeBundles = survivingBundles;
  }

  await Promise.all(
    activeBundles.map(async ({ proposal, markets }) => {
      try {
        const alerted = await processProposal(proposal, markets, orderbookMap, params, logger);
        if (alerted) await persistNotified(proposal, logger);
      } catch (err) {
        await logErrorAndPersist(proposal, err as Error);
      }
    })
  );

  console.log("All proposals have been checked!");
}
