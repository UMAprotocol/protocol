import { getRetryProvider, paginatedEventQuery as umaPaginatedEventQuery } from "@uma/common";
import { createHttpClient } from "@uma/toolkit";
import { AxiosError, AxiosInstance } from "axios";
export const paginatedEventQuery = umaPaginatedEventQuery;

import type { Provider } from "@ethersproject/abstract-provider";

import { BigNumber, Contract, Event, EventFilter, ethers } from "ethers";

import { getAddress, OptimisticOracleEthers, OptimisticOracleV2Ethers } from "@uma/contracts-node";
import {
  DisputePriceEvent,
  ProposePriceEvent,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import { getContractInstanceWithProvider } from "../utils/contracts";

import { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

import umaSportsOracleAbi from "./abi/umaSportsOracle.json";

const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

import * as s from "superstruct";

export { Logger };

export const ONE_SCALED = ethers.utils.parseUnits("1", 18);

export const POLYGON_BLOCKS_PER_HOUR = 1800;

// Get Polymarket initializer whitelist from env
const getPolymarketInitializerWhitelist = (): string[] => {
  const envWhitelist = process.env.POLYMARKET_INITIALIZER_WHITELIST;
  if (envWhitelist) {
    const parsed = JSON.parse(envWhitelist);
    if (Array.isArray(parsed)) {
      return parsed.map((addr) => addr.toString().toLowerCase());
    }
    throw new Error("POLYMARKET_INITIALIZER_WHITELIST must be a JSON array");
  }

  console.log("POLYMARKET_INITIALIZER_WHITELIST not provided, using empty whitelist");
  return [];
};

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

export interface MonitoringParams {
  ctfExchangeAddress: string;
  ctfSportsOracleAddress: string;
  additionalRequesters: string[];
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
  fillEventsLookbackSeconds: number;
  fillEventsProposalGapSeconds: number;
  httpClient: ReturnType<typeof createHttpClient>;
  orderBookBatchSize: number;
  ooV2Addresses: string[];
  ooV1Addresses: string[];
  aiConfig?: AIConfig;
}
interface PolymarketMarketGraphql {
  question: string;
  outcomes: string;
  outcomePrices: string;
  volumeNum: number;
  clobTokenIds: string;
  questionID: string;
}

export interface PolymarketMarketGraphqlProcessed {
  volumeNum: number;
  outcomes: [string, string];
  outcomePrices: [string, string];
  clobTokenIds: [string, string];
  question: string;
  questionID: string;
}

export interface PolymarketTradeInformation {
  price: number;
  type: "buy" | "sell";
  amount: number;
  timestamp: number;
}

export interface PolymarketOrderBook {
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
  proposer: string;
  identifier: string;
  ancillaryData: string;
  proposalBlockNumber: number;
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
  requesterAddresses: string[],
  ooAddress: string
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
    params.provider,
    ooAddress
  );

  const proposeEvents = await paginatedEventQuery<ProposePriceEvent>(
    oo,
    oo.filters.ProposePrice(null, null, null, null, null, null, null, null),
    searchConfig,
    params.retryAttempts,
    queryFilterSafe
  );

  const disputeEvents = await paginatedEventQuery<DisputePriceEvent>(
    oo,
    oo.filters.DisputePrice(null, null, null, null, null, null, null),
    searchConfig,
    params.retryAttempts,
    queryFilterSafe
  );

  const disputedRequestIds = new Set(
    disputeEvents.map((event) =>
      ethers.utils.keccak256(
        ethers.utils.solidityPack(
          ["address", "bytes32", "uint256", "bytes"],
          [event.args.requester, event.args.identifier, event.args.timestamp, event.args.ancillaryData]
        )
      )
    )
  );

  const currentTime = Math.floor(Date.now() / 1000);
  const currentTimeBN = BigNumber.from(currentTime);
  const threshold = BigNumber.from(params.checkBeforeExpirationSeconds);

  return Promise.all(
    proposeEvents
      .filter((event) => requesterAddresses.map((r) => r.toLowerCase()).includes(event.args.requester.toLowerCase()))
      .filter((event) => {
        const expirationTime = event.args.expirationTimestamp;
        const thresholdTime = expirationTime.sub(threshold);
        // Only keep if current time is greater than (expiration - threshold) but less than expiration.
        return currentTimeBN.gt(thresholdTime) && currentTimeBN.lt(expirationTime);
      })
      .filter((event) => {
        const requestId = ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ["address", "bytes32", "uint256", "bytes"],
            [event.args.requester, event.args.identifier, event.args.timestamp, event.args.ancillaryData]
          )
        );
        return !disputedRequestIds.has(requestId);
      })
      .map(async (event) => {
        const proposalTimestamp = BigNumber.from(
          await params.provider.getBlock(event.blockNumber).then((block) => block.timestamp)
        );
        return {
          requestHash: event.transactionHash,
          requestLogIndex: event.logIndex,
          requester: event.args.requester,
          proposer: event.args.proposer,
          identifier: event.args.identifier,
          requestTimestamp: event.args.timestamp,
          ancillaryData: event.args.ancillaryData,
          proposalBlockNumber: event.blockNumber,
          proposedPrice: event.args.proposedPrice,
          proposalTimestamp,
          proposalHash: event.transactionHash,
          proposalExpirationTimestamp: event.args.expirationTimestamp,
          proposalLogIndex: event.logIndex,
        };
      })
  );
};

// Extract initializer address from ancillary data
export const extractInitializerFromAncillaryData = (ancillaryData: string): string | null => {
  // Check if ancillary data ends with "initializer:..." pattern (there is no 0x prefix)
  const initializerMatch = ancillaryData.match(/initializer:([0-9a-fA-F]{40})$/);
  if (initializerMatch) {
    return "0x" + initializerMatch[1];
  }

  // If no initializer key found, return null
  return null;
};

// Get reward amount from contract's requests mapping via eth_call
export const getRewardForProposal = async (
  params: MonitoringParams,
  proposal: OptimisticPriceRequest,
  version: "v1" | "v2"
): Promise<BigNumber> => {
  const oo = await getContractInstanceWithProvider<OptimisticOracleEthers | OptimisticOracleV2Ethers>(
    version == "v1" ? "OptimisticOracle" : "OptimisticOracleV2",
    params.provider
  );

  // Calculate the request ID as done in the contract: keccak256(abi.encodePacked(requester, identifier, timestamp, ancillaryData))
  const requestId = ethers.utils.keccak256(
    ethers.utils.solidityPack(
      ["address", "bytes32", "uint256", "bytes"],
      [proposal.requester, proposal.identifier, proposal.requestTimestamp, proposal.ancillaryData]
    )
  );

  // Use eth_call to read from the requests mapping directly - this is much more efficient than event queries
  const request = await oo.requests(requestId);
  return request.reward;
};

// Check if a proposal should be ignored based on 3rd party criteria
export const shouldIgnoreThirdPartyProposal = async (
  params: MonitoringParams,
  proposal: OptimisticPriceRequest,
  version: "v1" | "v2"
): Promise<boolean> => {
  let criteriaCount = 0;

  // 1. Check if reward is 0
  const reward = await getRewardForProposal(params, proposal, version);
  if (reward.eq(0)) {
    criteriaCount++;
  }

  // 2. Check if initializer is not on whitelist (only if whitelist is configured)
  // Decode hex ancillary data to string first
  const ancillaryDataString = ethers.utils.toUtf8String(proposal.ancillaryData);
  const initializer = extractInitializerFromAncillaryData(ancillaryDataString);
  const whitelist = getPolymarketInitializerWhitelist();
  if (initializer && whitelist.length > 0 && !whitelist.includes(initializer.toLowerCase())) {
    criteriaCount++;
  }

  // 3. Check if initializer matches proposer (already available in proposal data)
  if (initializer && initializer.toLowerCase() === proposal.proposer.toLowerCase()) {
    criteriaCount++;
  }

  // Return true if >= 2 criteria are met (should ignore)
  return criteriaCount >= 2;
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
        questionID
      }
    }
    `;
  const { data } = await params.httpClient.post<GraphQLResponse<{ markets: PolymarketMarketGraphql[] }>>(
    params.graphqlEndpoint,
    { query },
    {
      headers: { authorization: `Bearer ${params.polymarketApiKey}` },
    }
  );

  if (data.errors?.length) {
    throw new Error(data.errors.map((e) => e.message).join("; "));
  }

  if (!data.data?.markets) {
    throw new Error("No markets found");
  }

  const { markets } = data.data;

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
    searchConfig,
    params.retryAttempts,
    queryFilterSafe
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

export async function getOrFallback<T>(
  client: AxiosInstance,
  url: string,
  fallback: T,
  opts?: {
    statusCode?: number;
    errorMessage?: string;
  }
): Promise<T> {
  try {
    const resp = await client.get<T>(url);
    return resp.data;
  } catch (err) {
    const axiosErr = err as AxiosError<{ error?: string }>;
    const statusMatches = opts?.statusCode ? axiosErr.response?.status === opts.statusCode : false;
    const messageMatches = opts?.errorMessage != null ? axiosErr.response?.data?.error === opts.errorMessage : false;

    if (statusMatches && (opts?.errorMessage == null || messageMatches)) {
      return fallback;
    }
    throw err;
  }
}

export const getPolymarketOrderBook = async (
  params: MonitoringParams,
  clobTokenIds: [string, string]
): Promise<[MarketOrderbook, MarketOrderbook]> => {
  const [marketOne, marketTwo] = clobTokenIds;
  const apiUrlOne = params.apiEndpoint + `/book?token_id=${marketOne}`;
  const apiUrlTwo = params.apiEndpoint + `/book?token_id=${marketTwo}`;

  // Default to [] if the API returns an a 404 error with the message "No orderbook exists for the requested token id"
  const outcome1Data = await getOrFallback(
    params.httpClient,
    apiUrlOne,
    { bids: [], asks: [] },
    {
      statusCode: 404,
      errorMessage: "No orderbook exists for the requested token id",
    }
  );

  const outcome2Data = await getOrFallback(
    params.httpClient,
    apiUrlTwo,
    { bids: [], asks: [] },
    {
      statusCode: 404,
      errorMessage: "No orderbook exists for the requested token id",
    }
  );

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
      bids: stringToNumber(outcome1Data.bids),
      asks: stringToNumber(outcome1Data.asks),
    },
    {
      bids: stringToNumber(outcome2Data.bids),
      asks: stringToNumber(outcome2Data.asks),
    },
  ];
};

export interface BookParams {
  token_id: string;
}

export async function getPolymarketOrderBooks(
  params: MonitoringParams,
  tokenIds: string[]
): Promise<Record<string, MarketOrderbook>> {
  const batchSize = params.orderBookBatchSize;
  const apiUrl = `${params.apiEndpoint}/books`;

  type RawOrderBook = {
    asset_id: string;
    bids: { price: string; size: string }[];
    asks: { price: string; size: string }[];
  };

  const toNumeric = (orders: { price: string; size: string }[]) =>
    orders.map((o) => ({ price: Number(o.price), size: Number(o.size) }));

  // Split the clob IDs into batches that respect the limit.
  const chunks: string[][] = [];
  for (let i = 0; i < tokenIds.length; i += batchSize) {
    chunks.push(tokenIds.slice(i, i + batchSize));
  }

  // Fire off every API call in parallel.
  const chunkResults = await Promise.all(
    chunks.map((ids) => {
      const payload: BookParams[] = ids.map((token_id) => ({ token_id }));
      return params.httpClient.post<RawOrderBook[]>(apiUrl, payload).then((res) => res.data);
    })
  );

  // Consolidate all partial order books into one look-up map.
  const map: Record<string, MarketOrderbook> = {};
  for (const rawBooks of chunkResults) {
    for (const ob of rawBooks) {
      map[ob.asset_id] = { bids: toNumeric(ob.bids), asks: toNumeric(ob.asks) };
    }
  }

  // Guarantee every requested ID appears, even if the API returned none.
  for (const id of tokenIds) {
    if (!map[id]) map[id] = { bids: [], asks: [] };
  }

  return map;
}

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

export interface UMAAIRetry {
  id: string;
  question_id: string;
  data: {
    input: {
      timing?: {
        expiration_timestamp?: number;
      };
    };
  };
}

export interface UMAAIRetriesLatestResponse {
  elements: UMAAIRetry[];
  next_cursor: string | null;
  has_more: boolean;
  total_count: number;
  total_pages: number;
}
interface AIRetryLookupResult {
  deeplink?: string;
}

export async function fetchLatestAIDeepLink(
  proposal: OptimisticPriceRequest,
  params: MonitoringParams,
  logger: typeof Logger
): Promise<AIRetryLookupResult> {
  if (!params.aiConfig) {
    return { deeplink: undefined };
  }
  try {
    const questionId = calculatePolymarketQuestionID(proposal.ancillaryData);
    const response = await params.httpClient.get<UMAAIRetriesLatestResponse>(params.aiConfig.apiUrl, {
      params: {
        limit: 50,
        search: questionId,
        last_page: false,
        project_id: params.aiConfig.projectId,
      },
    });

    const result = response.data?.elements?.find(
      (element) => element.data.input.timing?.expiration_timestamp === proposal.proposalExpirationTimestamp.toNumber()
    );

    if (!result) {
      logger.warning({
        at: "PolymarketMonitor",
        message: "No AI deeplink found for proposal",
        proposalHash: proposal.proposalHash,
        expirationTimestamp: proposal.proposalExpirationTimestamp.toNumber(),
        questionId: questionId,
        response: {
          data: response.data,
          status: response.status,
          statusText: response.statusText,
        },
        notificationPath: "otb-monitoring",
      });
      return { deeplink: undefined };
    }

    return {
      deeplink: `${params.aiConfig.resultsBaseUrl}/${result.id}`,
    };
  } catch (error) {
    logger.debug({
      at: "PolymarketMonitor",
      message: "Failed to fetch AI deeplink",
      error: error instanceof Error ? error.message : String(error),
      proposalHash: proposal.proposalHash,
    });
    return { deeplink: undefined };
  }
}

export const getProposalKeyToStore = (market: StoredNotifiedProposal | OptimisticPriceRequest): string => {
  return market.proposalHash;
};

export const isProposalNotified = async (proposal: OptimisticPriceRequest): Promise<boolean> => {
  const keyName = getProposalKeyToStore(proposal);
  const key = datastore.key(["NotifiedProposals", keyName]);
  const [entity] = await datastore.get(key);
  return Boolean(entity);
};

export const getInitialConfirmationLoggedKey = (marketId: string): string =>
  `polymarket:initial-confirmation-logged:${marketId}`;

export const isInitialConfirmationLogged = async (marketId: string): Promise<boolean> => {
  const keyName = getInitialConfirmationLoggedKey(marketId);
  const key = datastore.key(["NotifiedProposals", keyName]);
  const [entity] = await datastore.get(key);
  return Boolean(entity);
};

export const markInitialConfirmationLogged = async (marketId: string): Promise<void> => {
  const keyName = getInitialConfirmationLoggedKey(marketId);
  const key = datastore.key(["NotifiedProposals", keyName]);
  await datastore.save({
    key,
    data: {
      key: keyName,
      createdAt: new Date().toISOString(),
    },
  });
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

export const parseEnvList = (env: NodeJS.ProcessEnv, key: string, defaultValue: string[]): string[] => {
  const rawValue = env[key];
  if (!rawValue) return defaultValue;

  let output: string[];
  try {
    output = JSON.parse(rawValue);
  } catch (error) {
    throw new Error(`${key} is not valid JSON.`);
  }

  if (!Array.isArray(output)) {
    throw new Error(`${key} is valid JSON, but not an array.`);
  }

  return output;
};

export const parseEnvJson = <T>(env: NodeJS.ProcessEnv, key: string, defaultValue: T): T => {
  const rawValue = env[key];
  if (!rawValue) return defaultValue;
  return JSON.parse(rawValue);
};

export interface AIConfig {
  projectId: string;
  apiUrl: string;
  resultsBaseUrl: string;
}

export const initMonitoringParams = async (
  env: NodeJS.ProcessEnv,
  logger: typeof Logger
): Promise<MonitoringParams> => {
  const ctfExchangeAddress = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";
  const ctfSportsOracleAddress = "0xb21182d0494521Cf45DbbeEbb5A3ACAAb6d22093";

  const graphqlEndpoint = "https://gamma-api.polymarket.com/query";
  const apiEndpoint = "https://clob.polymarket.com";

  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  if (!env.POLYMARKET_API_KEY) throw new Error("POLYMARKET_API_KEY must be defined in env");
  const polymarketApiKey = env.POLYMARKET_API_KEY;

  const rawAiConfig = parseEnvJson<AIConfig>(env, "AI_CONFIG", {
    projectId: "",
    apiUrl: "",
    resultsBaseUrl: "",
  });

  // Only set aiConfig if all required fields are present
  const aiConfig = rawAiConfig.apiUrl && rawAiConfig.projectId && rawAiConfig.resultsBaseUrl ? rawAiConfig : undefined;

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
  const fillEventsLookbackSeconds = env.FILL_EVENTS_LOOKBACK_SECONDS ? Number(env.FILL_EVENTS_LOOKBACK_SECONDS) : 1800; // default to 30 minutes
  const fillEventsProposalGapSeconds = env.FILL_EVENTS_PROPOSAL_GAP_SECONDS
    ? Number(env.FILL_EVENTS_PROPOSAL_GAP_SECONDS)
    : 300; // default to 5 minutes

  const maxConcurrentRequests = env.MAX_CONCURRENT_REQUESTS ? Number(env.MAX_CONCURRENT_REQUESTS) : 5;
  const minTimeBetweenRequests = env.MIN_TIME_BETWEEN_REQUESTS ? Number(env.MIN_TIME_BETWEEN_REQUESTS) : 200;

  const httpTimeout = env.HTTP_TIMEOUT ? Number(env.HTTP_TIMEOUT) : 10_000;

  const shouldResetTimeout = env.SHOULD_RESET_TIMEOUT !== "false";

  const orderBookBatchSize = env.ORDER_BOOK_BATCH_SIZE ? Number(env.ORDER_BOOK_BATCH_SIZE) : 499;

  // Rate limit and retry with exponential backoff and jitter to handle rate limiting and errors from the APIs.
  const httpClient = createHttpClient({
    axios: { timeout: httpTimeout },
    rateLimit: { maxConcurrent: maxConcurrentRequests, minTime: minTimeBetweenRequests },
    retry: {
      retries: retryAttempts,
      baseDelayMs: retryDelayMs,
      shouldResetTimeout,
      onRetry: (retryCount, err, config) => {
        logger.debug({
          at: "PolymarketMonitor",
          message: `http-retry attempt #${retryCount} for ${config?.url} after ${err.code}:${err.message}`,
        });
      },
    },
  });

  const ooV2Addresses = parseEnvList(env, "OOV2_ADDRESSES", [await getAddress("OptimisticOracleV2", chainId)]);
  const ooV1Addresses = parseEnvList(env, "OOV1_ADDRESSES", [await getAddress("OptimisticOracle", chainId)]);

  const additionalRequesters = parseEnvList(env, "POLYMARKET_ADDITIONAL_REQUESTERS", []);

  return {
    ctfExchangeAddress,
    ctfSportsOracleAddress,
    additionalRequesters,
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
    fillEventsLookbackSeconds,
    fillEventsProposalGapSeconds,
    httpClient,
    orderBookBatchSize,
    ooV2Addresses,
    ooV1Addresses,
    aiConfig,
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

/**
 * @dev This function is a wrapper around the queryFilter function that splits the query into smaller chunks if the query is too large.
 * @param contract - The contract to query.
 * @param filter - The filter to apply to the query.
 * @param fromBlock - The block number to start the query from.
 * @param toBlock - The block number to end the query at.
 * @returns The filtered events.
 */
export function queryFilterSafe(contract: Contract) {
  return async function <T extends Event = Event>(
    filter: EventFilter,
    fromBlock: number,
    toBlock: number
  ): Promise<T[]> {
    try {
      return (await contract.queryFilter(filter, fromBlock, toBlock)) as T[];
    } catch (err: any) {
      const msg = String(err?.error?.message ?? err);
      if (msg.includes("query returned more than")) {
        if (fromBlock === toBlock)
          throw new Error(
            `Block ${fromBlock} alone returns more logs than provider can handle; further splitting impossible`
          );

        const mid = Math.floor((fromBlock + toBlock) / 2);

        // Recursively split window
        const [left, right] = await Promise.all([
          queryFilterSafe(contract)<T>(filter, fromBlock, mid),
          queryFilterSafe(contract)<T>(filter, mid + 1, toBlock),
        ]);

        return [...left, ...right];
      }
      throw err;
    }
  };
}
