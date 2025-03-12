import { getRetryProvider, paginatedEventQuery as umaPaginatedEventQuery } from "@uma/common";
export const paginatedEventQuery = umaPaginatedEventQuery;

import { NetworkerInterface } from "@uma/financial-templates-lib";

import type { Provider } from "@ethersproject/abstract-provider";
import { GraphQLClient } from "graphql-request";

import { BigNumber, Event, ethers } from "ethers";

import { OptimisticOracleEthers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { getContractInstanceWithProvider } from "../utils/contracts";

import { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

import umaSportsOracleAbi from "./abi/umaSportsOracle.json";

const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

import * as s from "superstruct";

export { Logger };

export const ONE_SCALED = ethers.utils.parseUnits("1", 18);

const POLYGON_BLOCKS_PER_HOUR = 1800;

export interface MonitoringParams {
  binaryAdapterAddress: string;
  ctfAdapterAddress: string;
  ctfAdapterAddressV2: string;
  ctfExchangeAddress: string;
  ctfSportsOracleAddress: string;
  maxBlockLookBack: number;
  graphqlEndpoint: string;
  polymarketApiKey: string;
  apiEndpoint: string;
  provider: Provider;
  chainId: number;
  pollingDelay: number;
  unknownProposalNotificationInterval: number;
  retryAttempts: number;
  retryDelayMs: number;
  checkBeforeExpirationSeconds: number;
}
interface PolymarketMarketGraphql {
  question: string;
  outcomes: string;
  outcomePrices: string;
  volumeNum: number;
  clobTokenIds: string;
}

export interface PolymarketMarketGraphqlProcessed {
  volumeNum: number;
  outcomes: [string, string];
  outcomePrices: [string, string];
  clobTokenIds: [string, string];
  question: string;
}

export interface PolymarketTradeInformation {
  price: number;
  type: "buy" | "sell";
  amount: number;
  timestamp: number;
}

interface PolymarketOrderBook {
  market: string;
  asset_id: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
  hash: string;
}

export type Order = { price: number; size: number }[];

export interface MarketOrderbook {
  bids: Order;
  asks: Order;
}

export interface OptimisticPriceRequest {
  requestHash: string;
  requestTimestamp: BigNumber;
  requestLogIndex: number;
  requester: string;
  ancillaryData: string;
  requestBlockNumber: number;
  proposedPrice: BigNumber;
  proposalTimestamp: BigNumber;
  proposalHash: string;
  proposalExpirationTimestamp: BigNumber;
  proposalLogIndex: number;
}

interface StoredNotifiedProposal {
  proposalHash: string;
}

export enum MarketType {
  Winner,
  Spreads,
  Totals,
}

export enum Ordering {
  HomeVsAway,
  AwayVsHome,
}

export enum Underdog {
  Home,
  Away,
}

export type Market = {
  marketType: MarketType;
  ordering: Ordering;
  underdog: Underdog;
  line: ethers.BigNumber;
};

export const getPolymarketProposedPriceRequestsOO = async (
  params: MonitoringParams,
  version: "v1" | "v2",
  requesterAddresses: string[]
): Promise<OptimisticPriceRequest[]> => {
  const currentBlockNumber = await params.provider.getBlockNumber();
  const oneDayInBlocks = POLYGON_BLOCKS_PER_HOUR * 24;
  const startBlockNumber = currentBlockNumber - oneDayInBlocks;
  const maxBlockLookBack = params.maxBlockLookBack;

  const searchConfig = {
    fromBlock: startBlockNumber,
    toBlock: currentBlockNumber,
    maxBlockLookBack,
  };

  const oo = await getContractInstanceWithProvider<OptimisticOracleEthers | OptimisticOracleV2Ethers>(
    version == "v1" ? "OptimisticOracle" : "OptimisticOracleV2",
    params.provider
  );

  const events = await paginatedEventQuery<ProposePriceEvent>(
    oo,
    oo.filters.ProposePrice(null, null, null, null, null, null, null, null),
    searchConfig
  );

  const currentTime = Math.floor(Date.now() / 1000);

  return events
    .filter((event) => requesterAddresses.map((r) => r.toLowerCase()).includes(event.args.requester.toLowerCase()))
    .filter((event) =>
      event.args.expirationTimestamp.gt(BigNumber.from(currentTime + params.checkBeforeExpirationSeconds))
    )
    .map((event) => {
      return {
        requestHash: event.transactionHash,
        requestLogIndex: event.logIndex,
        requester: event.args.requester,
        requestTimestamp: event.args.timestamp,
        ancillaryData: event.args.ancillaryData,
        requestBlockNumber: event.blockNumber,
        proposedPrice: event.args.proposedPrice,
        proposalTimestamp: event.args.timestamp,
        proposalHash: event.transactionHash,
        proposalExpirationTimestamp: event.args.expirationTimestamp,
        proposalLogIndex: event.logIndex,
      };
    });
};

export const getPolymarketMarketInformation = async (
  logger: typeof Logger,
  params: MonitoringParams,
  questionID: string
): Promise<PolymarketMarketGraphqlProcessed[]> => {
  const query = `
    {
      markets(where: "LOWER(question_id) = LOWER('${questionID}') or LOWER(neg_risk_request_id) = LOWER('${questionID}') or LOWER(game_id) = LOWER('${questionID}')") {
        clobTokenIds
        volumeNum
        outcomes
        outcomePrices
        question
      }
    }
    `;

  const graphQLClient = new GraphQLClient(params.graphqlEndpoint, {
    headers: {
      authorization: `Bearer ${params.polymarketApiKey}`,
    },
  });

  const { markets } = (await graphQLClient.request(query)) as {
    markets: PolymarketMarketGraphql[];
  };

  logger.info({
    at: "PolymarketMonitor",
    message: "Logging polymarket market data received from subgraph",
    markets,
    questionID,
  });

  if (!markets.length) {
    throw new Error(`No market found for question ID: ${questionID}`);
  }

  return markets.map((market) => {
    return {
      ...market,
      outcomes: JSON.parse(market.outcomes),
      outcomePrices: JSON.parse(market.outcomePrices),
      clobTokenIds: JSON.parse(market.clobTokenIds),
    };
  });
};

const getTradeInfoFromOrderFilledEvent = async (
  provider: Provider,
  event: any
): Promise<PolymarketTradeInformation> => {
  const blockTimestamp = (await provider.getBlock(event.blockNumber)).timestamp;
  const isBuy = event.args.makerAssetId.toString() === "0";
  const numerator = (isBuy ? event.args.makerAmountFilled : event.args.takerAmountFilled).mul(1000);
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

export const getOrderFilledEvents = async (
  params: MonitoringParams,
  clobTokenIds: [string, string],
  startBlockNumber: number
): Promise<[PolymarketTradeInformation[], PolymarketTradeInformation[]]> => {
  const ctfExchange = new ethers.Contract(
    params.ctfExchangeAddress,
    require("./abi/ctfExchange.json"),
    params.provider
  );

  const currentBlockNumber = await params.provider.getBlockNumber();
  const maxBlockLookBack = params.maxBlockLookBack;

  const searchConfig = {
    fromBlock: startBlockNumber,
    toBlock: currentBlockNumber,
    maxBlockLookBack,
  };

  const events: Event[] = await paginatedEventQuery(
    ctfExchange,
    ctfExchange.filters.OrderFilled(null, null, null, null, null, null, null, null),
    searchConfig
  );

  const outcomeTokenOne = await Promise.all(
    events
      .filter((event) => {
        return [event?.args?.takerAssetId.toString(), event?.args?.makerAssetId.toString()].includes(clobTokenIds[0]);
      })
      .map((event) => getTradeInfoFromOrderFilledEvent(params.provider, event))
  );

  const outcomeTokenTwo = await Promise.all(
    events
      .filter((event) => {
        return [event?.args?.takerAssetId.toString(), event?.args?.makerAssetId.toString()].includes(clobTokenIds[1]);
      })
      .map((event) => getTradeInfoFromOrderFilledEvent(params.provider, event))
  );

  return [outcomeTokenOne, outcomeTokenTwo];
};

export const calculatePolymarketQuestionID = (ancillaryData: string): string => {
  return ethers.utils.keccak256(ancillaryData);
};

export const getPolymarketOrderBook = async (
  params: MonitoringParams,
  clobTokenIds: [string, string],
  networker: NetworkerInterface
): Promise<[MarketOrderbook, MarketOrderbook]> => {
  const [marketOne, marketTwo] = clobTokenIds;
  const apiUrlOne = params.apiEndpoint + `/book?token_id=${marketOne}`;
  const apiUrlTwo = params.apiEndpoint + `/book?token_id=${marketTwo}`;

  // TODO: defaulting to [] is a temporary fix to handle the case where the API returns an error.
  // This means we just assume there are no orders on that side. We don't expect this to happen, but it
  // does occasionally. We should get to the bottom of this.
  const { bids: outcome1Bids = [], asks: outcome1Asks = [] } = (await networker.getJson(apiUrlOne, {
    method: "get",
  })) as PolymarketOrderBook;

  const { bids: outcome2Bids = [], asks: outcome2Asks = [] } = (await networker.getJson(apiUrlTwo, {
    method: "get",
  })) as PolymarketOrderBook;

  const stringToNumber = (
    orders: {
      price: string;
      size: string;
    }[]
  ) => {
    return orders.map((order) => {
      return {
        price: Number(order.price),
        size: Number(order.size),
      };
    });
  };

  return [
    {
      bids: stringToNumber(outcome1Bids),
      asks: stringToNumber(outcome1Asks),
    },
    {
      bids: stringToNumber(outcome2Bids),
      asks: stringToNumber(outcome2Asks),
    },
  ];
};

export async function getSportsMarketData(params: MonitoringParams, questionID: string): Promise<Market> {
  const umaSportsOracle = new ethers.Contract(params.ctfSportsOracleAddress, umaSportsOracleAbi, params.provider);
  return umaSportsOracle.getMarket(questionID);
}

export function decodeMultipleQueryPriceAtIndex(encodedPrice: BigNumber, index: number): BigNumber {
  if (index < 0 || index > 6) {
    throw new Error("Index out of range");
  }
  // Shift the bits of encodedPrice to the right by (32 * index) positions.
  // This moves the desired 32-bit segment to the least significant bits.
  // Then, we use bitwise AND with 0xffffffff (as a BigNumber) to extract that segment.
  return encodedPrice.shr(32 * index).and(BigNumber.from("0xffffffff"));
}

export function encodeMultipleQuery(values: string[]): BigNumber {
  if (values.length > 7) {
    throw new Error("Maximum of 7 values allowed");
  }
  let encodedPrice = BigNumber.from(0);
  for (let i = 0; i < values.length; i++) {
    if (!values[i]) {
      throw new Error("All values must be defined");
    }
    const numValue = Number(values[i]);
    if (!Number.isInteger(numValue)) {
      throw new Error("All values must be integers");
    }
    if (numValue > 0xffffffff || numValue < 0) {
      throw new Error("Values must be uint32 (0 <= value <= 2^32 - 1)");
    }
    // Shift the current value by 32 * i bits (placing the first value at the LSB)
    // then OR it into the encodedPrice.
    encodedPrice = encodedPrice.or(BigNumber.from(numValue).shl(32 * i));
  }
  return encodedPrice;
}
export function isUnresolvable(price: BigNumber | string): boolean {
  const maxInt256 = ethers.constants.MaxInt256;
  return typeof price === "string" ? price === maxInt256.toString() : price.eq(maxInt256);
}

export function decodeScores(
  ordering: Ordering,
  data: ethers.BigNumber
): { home: ethers.BigNumber; away: ethers.BigNumber } {
  const home = decodeMultipleQueryPriceAtIndex(data, ordering === Ordering.HomeVsAway ? 0 : 1);
  const away = decodeMultipleQueryPriceAtIndex(data, ordering === Ordering.HomeVsAway ? 1 : 0);
  return { home, away };
}

export function getSportsPayouts(market: Market, proposedPrice: ethers.BigNumber): [number, number] {
  const { home, away } = decodeScores(market.ordering, proposedPrice);
  const line = market.line.div(ethers.utils.parseUnits("1", 6));

  // Handle Spreads market
  if (market.marketType === MarketType.Spreads) {
    // Spreads are always: ["Favorite", "Underdog"]
    // Determine which score is underdog's based on market.underdog
    const [underdogScore, favoriteScore] = market.underdog === Underdog.Home ? [home, away] : [away, home];

    // Underdog wins if their score is higher OR if the spread (difference) is within the line.
    return underdogScore.gt(favoriteScore) || favoriteScore.sub(underdogScore).lte(line)
      ? [0, 1] // Underdog wins
      : [1, 0]; // Favorite wins
  }

  // Handle Totals market
  if (market.marketType === MarketType.Totals) {
    // Totals are always: ["Under", "Over"]
    const total = home.add(away);
    return total.lte(line) ? [0, 1] : [1, 0];
  }

  // Handle Draw (applicable for Winner markets)
  if (home.eq(away)) {
    return [1, 1];
  }

  // Handle Winner market for Home vs Away ordering
  if (market.ordering === Ordering.HomeVsAway) {
    return home.gt(away) ? [1, 0] : [0, 1];
  }

  // Handle Winner market for Away vs Home ordering
  return home.gt(away) ? [0, 1] : [1, 0];
}

const MultipleValuesQuery = s.object({
  // The title of the request
  title: s.string(),
  // Description of the request
  description: s.string(),
  // Values will be encoded into the settled price in the same order as the provided labels. The oracle UI will display each Label along with an input field. 7 labels maximum.
  labels: s.array(s.string()),
});
export type MultipleValuesQuery = s.Infer<typeof MultipleValuesQuery>;

const isMultipleValuesQueryFormat = (q: unknown) => s.is(q, MultipleValuesQuery);

export function decodeMultipleValuesQuery(decodedAncillaryData: string): MultipleValuesQuery {
  const endOfObjectIndex = decodedAncillaryData.lastIndexOf("}");
  const maybeJson = endOfObjectIndex > 0 ? decodedAncillaryData.slice(0, endOfObjectIndex + 1) : decodedAncillaryData;

  const json = JSON.parse(maybeJson);
  if (!isMultipleValuesQueryFormat(json)) throw new Error("Not a valid multiple values request");
  return json;
}

export const getProposalKeyToStore = (market: StoredNotifiedProposal | OptimisticPriceRequest): string => {
  return market.proposalHash;
};

export const storeNotifiedProposals = async (notifiedContracts: OptimisticPriceRequest[]): Promise<void> => {
  const promises = notifiedContracts.map((contract) => {
    const key = datastore.key(["NotifiedProposals", getProposalKeyToStore(contract)]);
    datastore.save({
      key: key,
      data: {
        proposalHash: contract.proposalHash,
      },
    });
  });
  await Promise.all(promises);
};

export const getNotifiedProposals = async (): Promise<{
  [key: string]: StoredNotifiedProposal;
}> => {
  const notifiedProposals = (await datastore.runQuery(datastore.createQuery("NotifiedProposals")))[0];
  return notifiedProposals.reduce((contracts: StoredNotifiedProposal[], contract: StoredNotifiedProposal) => {
    return {
      ...contracts,
      [getProposalKeyToStore(contract)]: contract,
    };
  }, {});
};

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const binaryAdapterAddress = "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130";
  const ctfAdapterAddress = "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74";
  const ctfAdapterAddressV2 = "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d";
  const ctfExchangeAddress = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
  const ctfSportsOracleAddress = "0xbec046ae23fee91643a45b03f12c6afdb2628d9c";

  const graphqlEndpoint = "https://gamma-api.polymarket.com/query";
  const apiEndpoint = "https://clob.polymarket.com";

  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  if (!env.POLYMARKET_API_KEY) throw new Error("POLYMARKET_API_KEY must be defined in env");
  const polymarketApiKey = env.POLYMARKET_API_KEY;

  // Creating provider will check for other chainId specific env variables.
  const provider = getRetryProvider(chainId) as Provider;

  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  const maxBlockLookBack = env.MAX_BLOCK_LOOK_BACK ? Number(env.MAX_BLOCK_LOOK_BACK) : 3499;
  const retryAttempts = env.RETRY_ATTEMPTS ? Number(env.RETRY_ATTEMPTS) : 1;
  const retryDelayMs = env.RETRY_DELAY_MS ? Number(env.RETRY_DELAY_MS) : 0;

  const unknownProposalNotificationInterval = env.UNKNOWN_PROPOSAL_NOTIFICATION_INTERVAL
    ? Number(env.UNKNOWN_PROPOSAL_NOTIFICATION_INTERVAL)
    : 300; // 5 minutes

  const checkBeforeExpirationSeconds = env.CHECK_BEFORE_EXPIRATION_SECONDS
    ? Number(env.CHECK_BEFORE_EXPIRATION_SECONDS)
    : 1800; // default to 30 minutes
  return {
    binaryAdapterAddress,
    ctfAdapterAddress,
    ctfAdapterAddressV2,
    ctfExchangeAddress,
    ctfSportsOracleAddress,
    maxBlockLookBack,
    graphqlEndpoint,
    polymarketApiKey,
    apiEndpoint,
    provider,
    chainId,
    pollingDelay,
    unknownProposalNotificationInterval,
    retryAttempts,
    retryDelayMs,
    checkBeforeExpirationSeconds,
  };
};

/**
 * Retries an async function if it errors up to N times with M delay between retries.
 * @param fn - The async function to retry.
 * @param retries - Number of times to retry the function.
 * @param delayMs - Delay between retries in milliseconds.
 * @returns A promise that resolves with the result of the async function.
 */
export async function retryAsync<T>(fn: () => Promise<T>, retries: number, delayMs: number): Promise<T> {
  let attempts = 0;

  // This will always run at least once, even if retries is set to 0 or less
  do {
    try {
      return await fn();
    } catch (error) {
      attempts++;
      if (attempts >= retries) {
        throw error;
      }
      await new Promise((res) => setTimeout(res, delayMs));
    }
  } while (attempts < retries);

  // Should never actually reach this, but for the sake of typescript
  throw new Error(`React a maximum of ${retries} retries.`);
}
