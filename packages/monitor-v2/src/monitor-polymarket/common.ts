import { getRetryProvider } from "@uma/common";
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

import { Multicall3Ethers } from "@uma/contracts-node";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import Web3 from "web3";

export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

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

interface PolymarketMarketWithAncillaryData extends PolymarketMarket {
  ancillaryData: string;
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

interface PolymarketOrderBook {
  market: string;
  asset_id: string;
  bids: { price: string; size: string }[];
  asks: { price: string; size: string }[];
  hash: string;
}

export type Order = { price: number; size: number }[];
export interface MarketOrderbooks {
  orderBooks: { bids: Order; asks: Order }[];
}

export interface StoredNotifiedProposal {
  txHash: string;
  question: string;
  proposedPrice: string;
  notificationTimestamp: number;
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
  const whereClause = "question_ID IS NOT NULL" + " AND clob_Token_Ids IS NOT NULL";

  const query = `
    {
      markets(where: "${whereClause}") {
        resolvedBy
        questionID
        createdAt
        question
        outcomes
        outcomePrices
        liquidityNum
        volumeNum
        clobTokenIds
        endDate
      }
    }
  `;

  const { markets: polymarketContracts } = (await request(params.graphqlEndpoint, query)) as any;

  // Remove markets with endDate after 1 week from now.
  const now = Math.floor(Date.now() / 1000);
  const oneWeek = 60 * 60 * 24 * 7;
  const filtered = polymarketContracts.filter((contract: { [k: string]: any }) => {
    const endDate = new Date(contract.endDate).getTime() / 1000;
    return endDate > now - oneWeek;
  });

  return filtered.map((contract: { [k: string]: any }) => ({
    ...contract,
    outcomes: JSON.parse(contract.outcomes),
    outcomePrices: JSON.parse(contract.outcomePrices),
    clobTokenIds: JSON.parse(contract.clobTokenIds),
  }));
};

export const getMarketsAncillary = async (
  params: MonitoringParams,
  markets: PolymarketMarket[],
  cache: Map<string, string>
): Promise<PolymarketMarketWithAncillaryData[]> => {
  console.log("Fetching ancillary data for markets...");
  console.log("Market cache length: ", cache.size);
  const failed = "failed";
  const binaryAdapterAbi = require("./abi/binaryAdapter.json");
  const ctfAdapterAbi = require("./abi/ctfAdapter.json");
  const binaryAdapter = new ethers.Contract(params.binaryAdapterAddress, binaryAdapterAbi, params.provider);
  const ctfAdapter = new ethers.Contract(params.ctfAdapterAddress, ctfAdapterAbi, params.provider);
  const decoder = TransactionDataDecoder.getInstance();

  // Manually add polymarket abi to the abi decoder global so aggregateTransactionsAndCall will return the correctly decoded data.
  decoder.abiDecoder.addABI(binaryAdapterAbi);
  decoder.abiDecoder.addABI(ctfAdapterAbi);

  const multicall = await getContractInstanceWithProvider<Multicall3Ethers>("Multicall3", params.provider);
  // Filter out markets with cached data and create calls for the remaining markets
  const filteredMarkets = markets.filter(
    (market) => !cache.has(market.questionID) && cache.get(market.questionID) !== failed
  );

  const calls = filteredMarkets.map((market) => {
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
  const chunkSize = 25;
  const chunks = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    chunks.push(calls.slice(i, i + chunkSize));
  }

  // Process the chunks sequentially, if the chunk fails, process the contents of the chunk individually.
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      // log progress
      console.log(`Processing ancillary fetching chunk ${i + 1} of ${chunks.length}`);
      const chunkResults = (await aggregateTransactionsAndCall(multicall.address, web3, chunk)) as {
        ancillaryData: string;
      }[];
      // Update the cache and results with the chunkResults
      chunkResults.forEach((result, index) => {
        const market = filteredMarkets[i * chunkSize + index];
        cache.set(market.questionID, result.ancillaryData);
      });
    } catch (error) {
      for (let j = 0; j < chunk.length; j++) {
        const call = chunk[j];
        const market = filteredMarkets[i * chunkSize + j];
        let ancillaryData;
        try {
          const adapter = market.resolvedBy === params.binaryAdapterAddress ? binaryAdapter : ctfAdapter;
          const result = await adapter.callStatic.questions(market.questionID);
          ancillaryData = result.ancillaryData;
        } catch {
          ancillaryData = failed;
          console.error("Failed to get ancillary data for market ", JSON.stringify(call), JSON.stringify(market));
        }
        cache.set(market.questionID, ancillaryData);
      }
    }
  }

  console.log("Finished fetching ancillary data for markets...");
  return markets.map((market) => {
    return {
      ...market,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ancillaryData: cache.get(market.questionID)!,
    };
  });
};

export const getPolymarketOrderBooks = async (
  params: MonitoringParams,
  markets: PolymarketWithEventData[],
  networker: NetworkerInterface
): Promise<(PolymarketWithEventData & MarketOrderbooks)[]> => {
  return await Promise.all(
    markets.map(async (market) => {
      const [marketOne, marketTwo] = market.clobTokenIds;
      const apiUrlOne = params.apiEndpoint + `/book?token_id=${marketOne}`;
      const apiUrlTwo = params.apiEndpoint + `/book?token_id=${marketTwo}`;
      const { bids: outcome1Bids, asks: outcome1Asks } = (await networker.getJson(apiUrlOne, {
        method: "get",
      })) as PolymarketOrderBook;

      const { bids: outcome2Bids, asks: outcome2Asks } = (await networker.getJson(apiUrlTwo, {
        method: "get",
      })) as PolymarketOrderBook;

      const stringToNumber = (orderBook: {
        bids: {
          price: string;
          size: string;
        }[];
        asks: {
          price: string;
          size: string;
        }[];
      }) => {
        return {
          bids: orderBook.bids.map((bid) => {
            return {
              price: Number(bid.price),
              size: Number(bid.size),
            };
          }),
          asks: orderBook.asks.map((ask) => {
            return {
              price: Number(ask.price),
              size: Number(ask.size),
            };
          }),
        };
      };

      return {
        ...market,
        ...{
          orderBooks: [
            stringToNumber({ bids: outcome1Bids || [], asks: outcome1Asks || [] }),
            stringToNumber({ bids: outcome2Bids || [], asks: outcome2Asks || [] }),
          ],
        },
      };
    })
  );
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

export const getMarketKeyToStore = (market: { txHash: string; question: string; proposedPrice: string }): string => {
  return market.txHash + "_" + market.question + "_" + market.proposedPrice;
};

export const storeNotifiedProposals = async (
  notifiedContracts: { txHash: string; question: string; proposedPrice: string }[]
): Promise<void> => {
  const currentTime = new Date().getTime();
  const promises = notifiedContracts.map((contract) => {
    const key = datastore.key(["NotifiedProposals", getMarketKeyToStore(contract)]);
    const data = {
      txHash: contract.txHash,
      question: contract.question,
      proposedPrice: contract.proposedPrice,
      notificationTimestamp: currentTime,
    };
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
      },
    };
  }, {});
};
