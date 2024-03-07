import { getRetryProvider, paginatedEventQuery } from "@uma/common";
import { NetworkerInterface } from "@uma/financial-templates-lib";
import { tryHexToUtf8String } from "../utils/contracts";

import type { Provider } from "@ethersproject/abstract-provider";
import { GraphQLClient } from "graphql-request";

import { Event, ethers } from "ethers";

import axios from "axios";
import { formatBytes32String } from "ethers/lib/utils";

export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

export const YES_OR_NO_QUERY = formatBytes32String("YES_OR_NO_QUERY");

export interface MarketKeyStoreData {
  txHash: string;
  question: string;
  proposedPrice: string;
}

export interface MonitoringParams {
  binaryAdapterAddress: string;
  ctfAdapterAddress: string;
  ctfAdapterAddressV2: string;
  ctfExchangeAddress: string;
  maxBlockLookBack: number;
  graphqlEndpoint: string;
  polymarketApiKey: string;
  apiEndpoint: string;
  provider: Provider;
  chainId: number;
  pollingDelay: number;
  unknownProposalNotificationInterval: number;
}
interface PolymarketMarketGraphql {
  question: string;
  outcomes: string;
  outcomePrices: string;
  volumeNum: number;
  clobTokenIds: string;
}

interface PolymarketMarketGraphqlProcessed {
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

export interface StoredNotifiedProposal {
  txHash: string;
  question: string;
  proposedPrice: string;
  notificationTimestamp: number;
  requestTimestamp?: string;
}

export interface SubgraphOptimisticPriceRequest {
  requestHash: string;
  requestTimestamp: string;
  requestLogIndex: string;
  requester: string;
  ancillaryData: string;
  requestBlockNumber: string;
  proposedPrice: string;
  proposalTimestamp: string;
  proposalHash: string;
  proposalExpirationTimestamp: string;
  proposalLogIndex: string;
}
interface OptimisticOracleSubgraphPriceRequests {
  data: {
    optimisticPriceRequests: SubgraphOptimisticPriceRequest[];
  };
}

interface ExtendedSubgraphOptimisticPriceRequest extends SubgraphOptimisticPriceRequest {
  questionID: string;
}

export const getProposedPriceRequestsOO = async (version: "v1" | "v2"): Promise<SubgraphOptimisticPriceRequest[]> => {
  let allResults: SubgraphOptimisticPriceRequest[] = [];
  let skip = 0;
  const first = 100; // Number of items to fetch per request
  let hasMore = true;

  while (hasMore) {
    const data = JSON.stringify({
      query: `{
        optimisticPriceRequests(skip: ${skip}, first: ${first}, where: {state: "Proposed"}) {
          requestHash
          requestLogIndex
          requester
          requestTimestamp
          ancillaryData
          requestBlockNumber
          proposedPrice
          proposalTimestamp
          proposalHash
          proposalExpirationTimestamp
          proposalLogIndex
        }
      }`,
      variables: {},
    });

    const config = {
      method: "post",
      maxBodyLength: Infinity,
      url: `https://api.thegraph.com/subgraphs/name/umaprotocol/polygon-optimistic-oracle${
        version === "v2" ? "-v2" : ""
      }`,
      headers: {
        "Content-Type": "application/json",
      },
      data: data,
    };

    try {
      const response = await axios.request<OptimisticOracleSubgraphPriceRequests>(config);
      const { data } = response;
      if (data && data.data && data.data.optimisticPriceRequests) {
        allResults = allResults.concat(data.data.optimisticPriceRequests);
        if (data.data.optimisticPriceRequests.length < first) {
          hasMore = false;
        } else {
          skip += first;
        }
      } else {
        hasMore = false;
      }
    } catch (error) {
      console.error("Error fetching data: ", error);
      throw error;
    }
  }

  return allResults.slice(0, 3);
};

export const getPolymarketMarketInformation = async (
  params: MonitoringParams,
  questionID: string
): Promise<PolymarketMarketGraphqlProcessed> => {
  const query = `
    {
      markets(where: "LOWER(question_ID) = LOWER('${questionID}')") {
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

  const market = markets[0];
  if (!market) {
    throw new Error(`No market found for question ID: ${questionID}`);
  }

  return {
    ...market,
    outcomes: JSON.parse(market.outcomes),
    outcomePrices: JSON.parse(market.outcomePrices),
    clobTokenIds: JSON.parse(market.clobTokenIds),
  };
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

export const findPolymarketQuestionIDs = async (
  params: MonitoringParams,
  liveProposalRequests: SubgraphOptimisticPriceRequest[]
): Promise<{
  found: ExtendedSubgraphOptimisticPriceRequest[];
  notFound: SubgraphOptimisticPriceRequest[];
}> => {
  const found: ExtendedSubgraphOptimisticPriceRequest[] = [];
  const notFound = [];
  for (const r of liveProposalRequests) {
    const questionInitialisedTopic = "0xeee0897acd6893adcaf2ba5158191b3601098ab6bece35c5d57874340b64c5b7";
    const receipt = await params.provider.getTransactionReceipt(r.requestHash);
    const questionId = receipt?.logs?.find((log) => log.topics[0] === questionInitialisedTopic)?.topics[1];

    if (questionId) {
      found.push({
        ...r,
        ancillaryData: tryHexToUtf8String(r.ancillaryData),
        questionID: questionId,
      });
    } else if (
      r.requester.toLowerCase() in
      [
        params.ctfAdapterAddress.toLowerCase(),
        params.ctfAdapterAddressV2.toLowerCase(),
        params.binaryAdapterAddress.toLowerCase(),
      ]
    ) {
      notFound.push({ ...r, ancillaryData: tryHexToUtf8String(r.ancillaryData) });
    }
  }
  return { found, notFound };
};

export const getPolymarketOrderBook = async (
  params: MonitoringParams,
  clobTokenIds: [string, string],
  networker: NetworkerInterface
): Promise<MarketOrderbook[]> => {
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

export const getUnknownProposalKeyData = (question: string): MarketKeyStoreData & { requestTimestamp?: string } => ({
  txHash: "unknown",
  question: question,
  proposedPrice: "unknown",
  requestTimestamp: "unknown",
});

export const getMarketKeyToStore = (market: MarketKeyStoreData & { requestTimestamp?: string }): string => {
  return market.txHash + "_" + market.question + "_" + market.proposedPrice + "_" + (market.requestTimestamp || "");
};

export const storeNotifiedProposals = async (
  notifiedContracts: {
    txHash: string;
    question: string;
    proposedPrice: string;
    requestTimestamp: string;
  }[]
): Promise<void> => {
  const currentTime = new Date().getTime() / 1000; // Current time in seconds
  const promises = notifiedContracts.map((contract) => {
    const key = datastore.key(["NotifiedProposals", getMarketKeyToStore(contract)]);
    const data = {
      txHash: contract.txHash,
      question: contract.question,
      proposedPrice: contract.proposedPrice,
      notificationTimestamp: currentTime,
      requestTimestamp: contract.requestTimestamp,
    } as StoredNotifiedProposal;
    datastore.save({ key: key, data: data });
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
      [getMarketKeyToStore(contract)]: {
        txHash: contract.txHash,
        question: contract.question,
        proposedPrice: contract.proposedPrice,
        notificationTimestamp: contract.notificationTimestamp,
        requestTimestamp: contract.requestTimestamp,
      } as StoredNotifiedProposal,
    };
  }, {});
};

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const binaryAdapterAddress = "0xCB1822859cEF82Cd2Eb4E6276C7916e692995130";
  const ctfAdapterAddress = "0x6A9D222616C90FcA5754cd1333cFD9b7fb6a4F74";
  const ctfAdapterAddressV2 = "0x2f5e3684cb1f318ec51b00edba38d79ac2c0aa9d";
  const ctfExchangeAddress = "0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E";

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

  const unknownProposalNotificationInterval = env.UNKNOWN_PROPOSAL_NOTIFICATION_INTERVAL
    ? Number(env.UNKNOWN_PROPOSAL_NOTIFICATION_INTERVAL)
    : 300; // 5 minutes

  return {
    binaryAdapterAddress,
    ctfAdapterAddress,
    ctfAdapterAddressV2,
    ctfExchangeAddress,
    maxBlockLookBack,
    graphqlEndpoint,
    polymarketApiKey,
    apiEndpoint,
    provider,
    chainId,
    pollingDelay,
    unknownProposalNotificationInterval,
  };
};
