import { getRetryProvider } from "@uma/common";
import { MulticallMakerDaoEthers } from "@uma/contracts-node";
import {
  aggregateTransactionsAndCall,
  delay,
  NetworkerInterface,
  TransactionDataDecoder,
} from "@uma/financial-templates-lib";
import { getContractInstanceWithProvider } from "../utils/contracts";

import type { Provider } from "@ethersproject/abstract-provider";
import request from "graphql-request";

import { ethers } from "ethers";

import { CTFExchangeEthers } from "@uma/contracts-node";
import { OrderFilledEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/CTFExchange";
import Web3 from "web3";
import { paginatedEventQuery } from "../utils/EventUtils";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";

export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

const POLYGON_SECONDS_PER_BLOCK = 2;

export interface BotModes {
  transactionsProposedEnabled: boolean;
}

export interface BlockRange {
  start: number;
  end: number;
}

export interface MonitoringParams {
  binaryAdapterAddress: string;
  ctfAdapterAddress: string;
  graphqlEndpoint: string;
  apiEndpoint: string;
  provider: Provider;
  chainId: number;
  blockRange: BlockRange;
  pollingDelay: number;
  botModes: BotModes;
}

interface PolymarketMarket {
  resolvedBy: string;
  questionID: string;
  createdAt: string;
  question: string;
  outcomes: [string, string];
  outcomePrices: [string, string];
  liquidityNum: number;
  volumeNum: number;
  clobTokenIds: [string, string];
}

export interface PolymarketWithEventData extends PolymarketMarketWithAncillaryData {
  txHash: string;
  requester: string;
  proposer: string;
  timestamp: number;
  expirationTimestamp: number;
  eventTimestamp: number;
  eventBlockNumber: number;
  eventIndex: number;
  proposalTimestamp: number;
  identifier: string;
  ancillaryData: string;
  proposedPrice: string;
}

export interface TradeInformation {
  price: number;
  type: "buy" | "sell";
  amount: number;
  timestamp: number;
}

export interface PolymarketWithTrades extends PolymarketWithEventData {
  orderFilledEvents: [TradeInformation[], TradeInformation[]];
  tradeSignals: [number, number];
}

interface PolymarketMarketWithAncillaryData extends PolymarketMarket {
  ancillaryData: string;
}

interface OrderBookPrice {
  t: number;
  p: number;
}
interface HistoricPricesPolymarket {
  history: OrderBookPrice[];
}

interface PolymarketWithHistoricPrices extends PolymarketWithTrades {
  historicPrices: [OrderBookPrice[], OrderBookPrice[]];
  historicOrderBookSignals: [number, number];
}

export const formatPriceEvents = async (
  events: ProposePriceEvent[]
): Promise<
  {
    txHash: string;
    requester: string;
    proposer: string;
    timestamp: number;
    eventTimestamp: number;
    eventBlockNumber: number;
    expirationTimestamp: number;
    proposalTimestamp: number;
    identifier: string;
    ancillaryData: string;
    proposedPrice: string;
    eventIndex: number;
  }[]
> => {
  const ooDefaultLiveness = 7200;
  return Promise.all(
    events.map(async (event: ProposePriceEvent) => {
      const block = await event.getBlock();
      return {
        txHash: event.transactionHash,
        requester: event.args.requester,
        proposer: event.args.proposer,
        timestamp: event.args.timestamp.toNumber(),
        eventTimestamp: block.timestamp,
        eventBlockNumber: event.blockNumber,
        expirationTimestamp: event.args.expirationTimestamp.toNumber(),
        proposalTimestamp: event.args.expirationTimestamp.toNumber() - ooDefaultLiveness,
        identifier: event.args.identifier,
        ancillaryData: event.args.ancillaryData,
        proposedPrice: ethers.utils.formatEther(event.args.proposedPrice),
        eventIndex: event.logIndex,
      };
    })
  );
};

export const getPolymarketMarkets = async (params: MonitoringParams): Promise<PolymarketMarket[]> => {
  const sevenDays = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7;
  const whereClause =
    "active = true" +
    " AND question_ID IS NOT NULL" +
    " AND clob_Token_Ids IS NOT NULL" +
    ` AND (resolved_by = '${params.binaryAdapterAddress}' OR resolved_by = '${params.ctfAdapterAddress}')` +
    ` AND EXTRACT(EPOCH FROM TO_TIMESTAMP(end_date, 'Month DD, YYYY')) > ${sevenDays}` +
    " AND uma_resolution_status='resolved'";

  const query = `
    {
      markets(where: "${whereClause}", order: "EXTRACT(EPOCH FROM TO_TIMESTAMP(end_date, 'Month DD, YYYY')) desc") {
        resolvedBy
        questionID
        createdAt
        question
        outcomes
        outcomePrices
        liquidityNum
        volumeNum
        clobTokenIds
      }
    }
  `;

  const { markets: polymarketContracts } = (await request(params.graphqlEndpoint, query)) as any;

  return polymarketContracts.map((contract: { [k: string]: any }) => ({
    ...contract,
    outcomes: JSON.parse(contract.outcomes),
    outcomePrices: JSON.parse(contract.outcomePrices),
    clobTokenIds: JSON.parse(contract.clobTokenIds),
  }));
};

export const getMarketsAncillary = async (
  params: MonitoringParams,
  markets: PolymarketMarket[]
): Promise<PolymarketMarketWithAncillaryData[]> => {
  const binaryAdapterAbi = require("./abi/binaryAdapter.json");
  const ctfAdapterAbi = require("./abi/ctfAdapter.json");
  const binaryAdapter = new ethers.Contract(params.binaryAdapterAddress, binaryAdapterAbi, params.provider);
  const decoder = TransactionDataDecoder.getInstance();
  const ctfAdapter = new ethers.Contract(params.ctfAdapterAddress, ctfAdapterAbi, params.provider);

  // Manually add polymarket abi to the abi decoder global so aggregateTransactionsAndCall will return the correctly decoded data.
  decoder.abiDecoder.addABI(binaryAdapterAbi);
  decoder.abiDecoder.addABI(ctfAdapterAbi);

  const multicall = await getContractInstanceWithProvider<MulticallMakerDaoEthers>(
    "MulticallMakerDao",
    params.provider
  );

  const calls = markets.map((market) => {
    const adapter = market.resolvedBy === params.binaryAdapterAddress ? binaryAdapter : ctfAdapter;
    return {
      target: adapter.address,
      callData: adapter.interface.encodeFunctionData("questions", [market.questionID]),
    };
  });

  const rpcUrl = process.env[`NODE_URL_${params.chainId}`];
  if (!rpcUrl) throw new Error(`NODE_URL_${params.chainId} not found in env`);

  const web3Provider = new Web3.providers.HttpProvider(rpcUrl);
  const web3 = new Web3(web3Provider);

  // batch call to multicall contract
  const chunkSize = 100;
  const chunks = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    chunks.push(calls.slice(i, i + chunkSize));
  }

  const results = (
    await Promise.all(
      chunks.map((chunk) => {
        return aggregateTransactionsAndCall(multicall.address, web3, chunk);
      })
    )
  ).flat(Infinity) as { ancillaryData: string }[];

  return markets.map((market, index) => {
    return {
      ...market,
      ancillaryData: results[index].ancillaryData,
    };
  });
};

export const getMarketsHistoricPrices = async (
  params: MonitoringParams,
  markets: PolymarketWithTrades[],
  networker: NetworkerInterface
): Promise<PolymarketWithHistoricPrices[]> => {
  return await Promise.all(
    markets.map(async (market) => {
      const startTs = Math.floor(new Date(market.createdAt).getTime());
      const endTs = market.expirationTimestamp;
      const marketOne = market.clobTokenIds[0];
      const marketTwo = market.clobTokenIds[1];
      const apiUrlOne = params.apiEndpoint + `/prices-history?startTs=${startTs}&endTs=${endTs}&market=${marketOne}`;
      const apiUrlTwo = params.apiEndpoint + `/prices-history?startTs=${startTs}&endTs=${endTs}&market=${marketTwo}`;
      const { history: outcome1HistoricPrices } = (await networker.getJson(apiUrlOne, {
        method: "get",
      })) as HistoricPricesPolymarket;

      const { history: outcome2HistoricPrices } = (await networker.getJson(apiUrlTwo, {
        method: "get",
      })) as HistoricPricesPolymarket;
      //

      return {
        ...market,
        historicPrices: [outcome1HistoricPrices, outcome2HistoricPrices],
        historicOrderBookSignals: [
          calculateOrderBooksSignal(outcome1HistoricPrices, market.expirationTimestamp),
          calculateOrderBooksSignal(outcome2HistoricPrices, market.expirationTimestamp),
        ],
      };
    })
  );
};

export const getTradeInfoFromOrderFilledEvent = async (
  provider: Provider,
  event: OrderFilledEvent
): Promise<TradeInformation> => {
  const blockTimestamp = (await provider.getBlock(event.blockNumber)).timestamp;
  const isBuy = event.args.makerAssetId.toString() === "0";
  const numerator = isBuy ? event.args.makerAmountFilled.mul(1000) : event.args.takerAmountFilled.mul(1000);
  const denominator = isBuy ? event.args.takerAmountFilled : event.args.makerAmountFilled;
  const price = numerator.div(denominator).toNumber() / 1000;
  return {
    price,
    type: isBuy ? "buy" : "sell",
    timestamp: blockTimestamp,
    // Convert to decimal value with 2 decimals
    amount: (isBuy ? event.args.takerAmountFilled : event.args.makerAmountFilled).div(10_000).toNumber() / 100,
  };
};

function calculateTWAP(
  trades: {
    price: number;
    amount: number;
    timestamp: number;
  }[],
  interval: number
): number {
  if (trades.length === 0) {
    return 0;
  }

  // Make sure the trades are sorted by timestamp
  trades.sort((a, b) => a.timestamp - b.timestamp);

  let twapSum = 0;
  let totalWeight = 0;
  let currentIntervalStart = trades[0].timestamp;
  let currentIntervalVolume = 0;
  let currentIntervalPriceSum = 0;

  for (const trade of trades) {
    // If the trade is outside the current interval, calculate the average price of the interval and add it to the total
    if (trade.timestamp >= currentIntervalStart + interval) {
      // Calculate the average price of the interval and add it to the total
      if (currentIntervalVolume > 0) {
        const intervalAveragePrice = currentIntervalPriceSum / currentIntervalVolume;
        twapSum += intervalAveragePrice * currentIntervalVolume;
        totalWeight += currentIntervalVolume;
      }

      // Start a new interval
      currentIntervalStart += interval * Math.floor((trade.timestamp - currentIntervalStart) / interval);
      currentIntervalVolume = 0;
      currentIntervalPriceSum = 0;
    }

    // Add the trade to the current interval
    currentIntervalVolume += trade.amount;
    currentIntervalPriceSum += trade.amount * trade.price;
  }

  // Calculate the average price of the last interval and add it to the total
  if (currentIntervalVolume > 0) {
    const intervalAveragePrice = currentIntervalPriceSum / currentIntervalVolume;
    twapSum += intervalAveragePrice * currentIntervalVolume;
    totalWeight += currentIntervalVolume;
  }

  // Calculate the TWAP
  const twap = totalWeight > 0 ? twapSum / totalWeight : 0;
  return twap;
}

export function calculateTradesSignal(
  trades: TradeInformation[],
  sizeThreshold: number,
  marketResolutionTimestamp: number
): number {
  const oneHourBeforeMarketResolution = marketResolutionTimestamp - 60 * 60;
  const lastHourTrades = trades.filter((trade) => trade.timestamp >= oneHourBeforeMarketResolution);

  // Calculate the last hour's trade volume
  const lastHourVolume = lastHourTrades.reduce((total, trade) => total + trade.amount, 0);

  // Calculate the total trade volume
  const totalVolume = trades.reduce((total, trade) => total + trade.amount, 0);

  // Calculate the volume ratio in the last hour
  const lastHourVolumeRatio = totalVolume == 0 ? 0 : lastHourVolume / totalVolume;

  // Calculate the TWAP for the given interval
  const twap = calculateTWAP(trades, 60 * 30); // 30 min interval

  // Find the last trade with an amount above the size threshold and within the last hour
  const lastSignificantTrade = trades
    .slice()
    .reverse()
    .find((trade) => trade.amount >= sizeThreshold && trade.timestamp >= oneHourBeforeMarketResolution);

  // If there's no significant trade, use TWAP as the signal
  if (!lastSignificantTrade) {
    return twap;
  }

  // Apply a heuristic based on the last hour's volume ratio
  const controversyFactor = lastHourVolumeRatio > 0.5 ? 1.3 : 1;

  // Calculate the weighted average of TWAP and the last significant trade price with the controversy factor
  const signal = (twap + lastSignificantTrade.price * controversyFactor) / (1 + controversyFactor);

  return signal;
}

export function calculateOrderBooksSignal(trades: OrderBookPrice[], marketResolutionTimestamp: number): number {
  const twoHourBeforeMarketResolution = marketResolutionTimestamp - 60 * 60 * 2;

  const lastTwoHoursTrades = trades.filter((trade) => trade.t >= twoHourBeforeMarketResolution);
  const tradesBeforeTwoHours = trades.filter((trade) => trade.t < twoHourBeforeMarketResolution);

  const twapBefore = calculateTWAP(
    tradesBeforeTwoHours.map((t) => ({ price: t.p, amount: 1, timestamp: t.t })),
    60 * 60 * 2 // 2 hour interval
  );

  // Caculate twap for last hour
  const lastHourTwap = calculateTWAP(
    lastTwoHoursTrades.map((t) => ({ price: t.p, amount: 1, timestamp: t.t })),
    60 * 15 // 15 min interval
  );

  // Apply a heuristic based on the last hour's volume ratio
  const lastHoursWeight = 1.3;

  return (twapBefore + lastHourTwap * lastHoursWeight) / (1 + lastHoursWeight);
}

export const getOrderFilledEvents = async (
  params: MonitoringParams,
  markets: PolymarketWithEventData[]
): Promise<PolymarketWithTrades[]> => {
  let ctfExchange;

  try {
    ctfExchange = await getContractInstanceWithProvider<CTFExchangeEthers>("CTFExchange", params.provider);
  } catch (e) {
    ctfExchange = await getContractInstanceWithProvider<CTFExchangeEthers>(
      "CTFExchange",
      params.provider,
      "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E"
    );
  }

  // get markets min eventBlockNumber
  const minEventBlockNumber = Math.min(...markets.map((market) => market.eventBlockNumber));
  const minEventBlockNumberTimestamp = (await params.provider.getBlock(minEventBlockNumber)).timestamp;
  const minCreatedAt = Math.min(...markets.map((market) => Math.floor(new Date(market.createdAt).getTime())));

  const fromBlock =
    minEventBlockNumberTimestamp > minCreatedAt
      ? minEventBlockNumber - Math.floor((minEventBlockNumberTimestamp - minCreatedAt) / POLYGON_SECONDS_PER_BLOCK)
      : minEventBlockNumberTimestamp;

  const maxBlockLookBack = 3499;

  const currentBlockNumber = await params.provider.getBlockNumber();
  const searchConfig = {
    fromBlock,
    toBlock: currentBlockNumber,
    maxBlockLookBack,
  };

  const events = await paginatedEventQuery<OrderFilledEvent>(
    ctfExchange,
    ctfExchange.filters.OrderFilled(null, null, null, null, null, null, null, null),
    searchConfig
  );

  const output: PolymarketWithTrades[] = [];
  for (let i = 0; i < markets.length; i++) {
    const market = markets[i];

    const outcomeTokenOne = await Promise.all(
      events
        .filter((event) => {
          return market.clobTokenIds[0] == event?.args?.takerAssetId.toString();
        })
        .map((event) => getTradeInfoFromOrderFilledEvent(params.provider, event))
    );

    const outcomeTokenTwo = await Promise.all(
      events
        .filter((event) => {
          return market.clobTokenIds[1] == event?.args?.makerAssetId.toString();
        })
        .map((event) => getTradeInfoFromOrderFilledEvent(params.provider, event))
    );

    const outcomeTokenOneSignal = calculateTradesSignal(outcomeTokenOne, 0, market.expirationTimestamp);
    const outcomeTokenTwoSignal = calculateTradesSignal(outcomeTokenTwo, 0, market.expirationTimestamp);

    output.push({
      ...market,
      orderFilledEvents: [outcomeTokenOne, outcomeTokenTwo],
      tradeSignals: [outcomeTokenOneSignal, outcomeTokenTwoSignal],
    });
  }
  return output;
};

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const binaryAdapterAddress = "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130";
  const ctfAdapterAddress = "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74";

  const graphqlEndpoint = "https://gamma-api.polymarket.com/query";
  const apiEndpoint = "https://clob.polymarket.com";

  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  const STARTING_BLOCK_KEY = `STARTING_BLOCK_NUMBER_${chainId}`;
  const ENDING_BLOCK_KEY = `ENDING_BLOCK_NUMBER_${chainId}`;

  // Creating provider will check for other chainId specific env variables.
  const provider = getRetryProvider(chainId) as Provider;

  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  if (pollingDelay === 0 && (!env[STARTING_BLOCK_KEY] || !env[ENDING_BLOCK_KEY])) {
    throw new Error(`Must provide ${STARTING_BLOCK_KEY} and ${ENDING_BLOCK_KEY} if running serverless`);
  }

  // If no block numbers are provided, default to the latest block.
  const latestBlockNumber: number = await provider.getBlockNumber();
  const startingBlock = env[STARTING_BLOCK_KEY] ? Number(env[STARTING_BLOCK_KEY]) : latestBlockNumber;
  const endingBlock = env[ENDING_BLOCK_KEY] ? Number(env[ENDING_BLOCK_KEY]) : latestBlockNumber;
  // In serverless it is possible for start block to be larger than end block if no new blocks were mined since last run.
  if (startingBlock > endingBlock && pollingDelay !== 0) {
    throw new Error(`${STARTING_BLOCK_KEY} must be less than or equal to ${ENDING_BLOCK_KEY}`);
  }

  const botModes = {
    transactionsProposedEnabled: env.TRANSACTIONS_PROPOSED_ENABLED === "true",
  };

  return {
    binaryAdapterAddress,
    ctfAdapterAddress,
    graphqlEndpoint,
    apiEndpoint,
    provider,
    chainId,
    blockRange: { start: startingBlock, end: endingBlock },
    pollingDelay,
    botModes,
  };
};

export const waitNextBlockRange = async (params: MonitoringParams): Promise<BlockRange> => {
  await delay(Number(params.pollingDelay));
  const latestBlockNumber: number = await params.provider.getBlockNumber();
  return { start: params.blockRange.end + 1, end: latestBlockNumber };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return params.pollingDelay === 0 ? "debug" : "info";
};
