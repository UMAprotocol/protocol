import { OptimisticOracleEthers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { Networker } from "@uma/financial-templates-lib";
import { paginatedEventQuery } from "@uma/common";
import {
  Logger,
  MonitoringParams,
  PolymarketWithEventData,
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
import { Event, ethers } from "ethers";

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

  const binaryAdapterAbi = require("./abi/binaryAdapter.json");
  const ctfAdapterAbi = require("./abi/ctfAdapter.json");
  const binaryAdapter = new ethers.Contract(params.binaryAdapterAddress, binaryAdapterAbi, params.provider);
  const ctfAdapter = new ethers.Contract(params.ctfAdapterAddress, ctfAdapterAbi, params.provider);
  const ctfExchange = new ethers.Contract(
    params.ctfExchangeAddress,
    require("./abi/ctfExchange.json"),
    params.provider
  );

  const searchConfigCtfAdapter = {
    fromBlock: 34876144,
    toBlock: currentBlockNumber,
    maxBlockLookBack,
  };

  const searchConfigBinaryAdapter = {
    fromBlock: 23569780,
    toBlock: currentBlockNumber,
    maxBlockLookBack,
  };

  // const binaryAdapterEvents: Event[] = await paginatedEventQuery(
  //   binaryAdapter,
  //   binaryAdapter.filters.QuestionInitialized(),
  //   searchConfigBinaryAdapter
  // );

  // const ctfAdapterEvents: Event[] = await paginatedEventQuery(
  //   ctfAdapter,
  //   ctfAdapter.filters.QuestionInitialized(),
  //   searchConfigCtfAdapter
  // );

  const oo = await getContractInstanceWithProvider<OptimisticOracleEthers>("OptimisticOracle", params.provider);
  const oov2 = await getContractInstanceWithProvider<OptimisticOracleV2Ethers>("OptimisticOracleV2", params.provider);

  const eventsOo = await paginatedEventQuery<ProposePriceEvent>(oo, oo.filters.ProposePrice(), searchConfig);
  const eventsOov2 = await paginatedEventQuery<ProposePriceEvent>(oov2, oov2.filters.ProposePrice(), searchConfig);
  // Merge the events from both OO versions.
  const proposalEvents = await formatPriceEvents([...eventsOo, ...eventsOov2]);

  const filteredEvents = proposalEvents.filter((event) =>
    [params.binaryAdapterAddress, params.ctfAdapterAddress].includes(event.requester)
  );

  // find if there is any event with requester = binaryAdapterAddress
  const binaryAdapterEvent = filteredEvents.find((event) => event.requester === params.binaryAdapterAddress);

  // find question ids
  for (const event of filteredEvents) {
    const ancillaryData = event.ancillaryData;
    const questionId = ethers.utils.keccak256(ancillaryData);
    const conditionId = ethers.utils.keccak256(
      ethers.utils.solidityPack(["address", "bytes32", "uint256"], [params.ctfAdapterAddress, questionId, 2])
    );

    const tk = await ctfExchange.queryFilter(ctfExchange.filters.TokenRegistered(null, null, conditionId));
    if (!tk.length) {
      console.log("no tk");
    }
    // get log with biggest logIndex
    const log = tk.reduce((prev, current) => (prev.logIndex > current.logIndex ? prev : current));

    if (!log || !log.args) throw new Error("no log found");
    const clobTokenIds = [log.args.token0.toString(), log.args.token1.toString()];
    // console.log(tk);
  }

  const markets = await getPolymarketMarkets(params);

  const marketsWithAncillary = await getMarketsAncillary(params, markets);

  // 34876144 ctf
  // 23569780 binary

  // const events: Event[] = await paginatedEventQuery(
  //   ctfExchange,
  //   ctfExchange.filters.OrderFilled(null, null, null, null, null, null, null, null),
  //   searchConfig
  // );

  // Find corresponding market for each proposal event.
  const marketsWithEventData: PolymarketWithEventData[] = proposalEvents
    // .filter((market) => market.expirationTimestamp > Date.now() / 1000)
    .filter((event) => [params.binaryAdapterAddress, params.ctfAdapterAddress].includes(event.requester))
    .filter((event) => {
      const market = marketsWithAncillary.find((market) => event.ancillaryData === market.ancillaryData);
      if (!market) {
        // This should never happen but if it does, we want to know about it.
        logger.error({
          at: "PolymarketMonitor",
          message: "Could not find market for proposal event",
          event,
        });
        return false;
      }
      // Filter out markets that have already been notified.
      return !Object.keys(pastNotifiedProposals).includes(
        getMarketKeyToStore({
          txHash: event.txHash,
          question: market.question,
          proposedPrice: event.proposedPrice,
          requestTimestamp: event.timestamp,
        })
      );
    })
    .map((event) => {
      const market = marketsWithAncillary.find(
        (market) => event.ancillaryData === market.ancillaryData // && event.timestamp === market.requestTimestamp
      );
      return {
        // disable eslint because we know market is defined here.
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        ...market!,
        ...event,
      };
    });

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
    const thresholdVolume = Number(process.env["THRESHOLD_VOLUME"]) || 1_000_000;

    const sellingWinnerSide = market.orderBooks[proposedOutcome].asks.find((ask) => ask.price < thresholdAsks);
    const buyingLoserSide = market.orderBooks[complementaryOutcome].bids.find((bid) => bid.price > thresholdBids);

    const soldWinnerSide = market.orderFilledEvents[proposedOutcome].filter(
      (event) => event.type == "sell" && event.price < thresholdAsks
    );
    const boughtLoserSide = market.orderFilledEvents[complementaryOutcome].filter(
      (event) => event.type == "buy" && event.price > thresholdBids
    );

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
      notifiedProposals.push(market);
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
      notifiedProposals.push(market);
    }
  }
  await storeNotifiedProposals(notifiedProposals);

  console.log("All proposals have been checked!");
}
