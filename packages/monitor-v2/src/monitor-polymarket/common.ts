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

import Web3 from "web3";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";

export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

// Helper function to sleep for a given duration
const sleep = (ms: number) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

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

export type OrderBookSide = { price: number; size: number }[];
export interface MarketOrderbooks {
  orderBooks: [{ bids: OrderBookSide; asks: OrderBookSide }, { bids: OrderBookSide; asks: OrderBookSide }];
}

export interface StoredNotifiedProposal {
  txHash: string;
  question: string;
  proposedPrice: string;
  notificationTimestamp: number;
}

// Helper function to process markets in chunks
const processMarketsInChunks = async (
  markets: PolymarketWithEventData[],
  chunkSize: number,
  callback: (m: PolymarketWithEventData[]) => Promise<void>
) => {
  for (let i = 0; i < markets.length; i += chunkSize) {
    const chunk = markets.slice(i, i + chunkSize);
    await callback(chunk);
    await sleep(500); // Introduce a 0.5 second delay between each chunk
  }
};

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
  const whereClause =
    " created_at > '2023-01-01'" +
    " AND question_ID IS NOT NULL" +
    " AND clob_Token_Ids IS NOT NULL" +
    ` AND (resolved_by = '${params.binaryAdapterAddress}' OR resolved_by = '${params.ctfAdapterAddress}')`;

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
  const ctfAdapter = new ethers.Contract(params.ctfAdapterAddress, ctfAdapterAbi, params.provider);
  const decoder = TransactionDataDecoder.getInstance();

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
  const chunkSize = 25;
  const chunks = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    chunks.push(calls.slice(i, i + chunkSize));
  }

  // Process the chunks sequentially, if the chunk fails, process the contents of the chunk individually.
  const results: { ancillaryData: string }[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const chunkResults = (await aggregateTransactionsAndCall(multicall.address, web3, chunk)) as {
        ancillaryData: string;
      }[];
      results.push(...chunkResults);
    } catch (error) {
      for (let j = 0; j < chunk.length; j++) {
        const call = chunk[j];
        try {
          const market = markets[i * chunkSize + j];
          const adapter = market.resolvedBy === params.binaryAdapterAddress ? binaryAdapter : ctfAdapter;
          const result = await adapter.callStatic.questions(market.questionID);
          results.push(result);
        } catch {
          results.push({ ancillaryData: "0x" });
          console.log("Failed to get ancillary data for market", call);
        }
      }
    }
  }

  return markets.map((market, index) => {
    return {
      ...market,
      ancillaryData: results[index].ancillaryData,
    };
  });
};

export const getPolymarketOrderBooks = async (
  params: MonitoringParams,
  markets: PolymarketWithEventData[],
  networker: NetworkerInterface
): Promise<(PolymarketWithEventData & MarketOrderbooks)[]> => {
  const results: (PolymarketWithEventData & MarketOrderbooks)[] = [];

  await processMarketsInChunks(markets, 30, async (marketChunk: PolymarketWithEventData[]) => {
    const chunkResults = await Promise.all(
      marketChunk.map(async (market) => {
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
          ...({
            orderBooks: [
              stringToNumber({ bids: outcome1Bids || [], asks: outcome1Asks || [] }),
              stringToNumber({ bids: outcome2Bids || [], asks: outcome2Asks || [] }),
            ],
          } as MarketOrderbooks),
        };
      })
    );

    results.push(...chunkResults);
  });

  return results;
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
