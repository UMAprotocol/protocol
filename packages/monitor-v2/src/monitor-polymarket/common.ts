import { getRetryProvider, paginatedEventQuery } from "@uma/common";
import { aggregateTransactionsAndCall, NetworkerInterface, TransactionDataDecoder } from "@uma/financial-templates-lib";
import { getContractInstanceWithProvider } from "../utils/contracts";

import type { Provider } from "@ethersproject/abstract-provider";
import request from "graphql-request";

import { BigNumber, Event, ethers } from "ethers";

import { Multicall3Ethers } from "@uma/contracts-node";
import { ProposePriceEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV2";
import Web3 from "web3";
import { formatBytes32String } from "ethers/lib/utils";

export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

const { Datastore } = require("@google-cloud/datastore");
const datastore = new Datastore();

export const YES_OR_NO_QUERY = formatBytes32String("YES_OR_NO_QUERY");

export interface BotModes {
  transactionsProposedEnabled: boolean;
}

export interface TradeInformation {
  price: number;
  type: "buy" | "sell";
  amount: number;
  timestamp: number;
}

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
  apiEndpoint: string;
  provider: Provider;
  chainId: number;
  pollingDelay: number;
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
  endDate: string;
  umaResolutionStatus: string;
}

interface PolymarketMarketGraphql {
  resolvedBy: string;
  questionID: string;
  createdAt: string;
  question: string;
  outcomes: string;
  outcomePrices: string;
  liquidityNum: number;
  volumeNum: number;
  clobTokenIds: string;
  endDate: string;
  umaResolutionStatus: string;
}

export interface PolymarketMarketWithAncillaryData extends PolymarketMarket {
  ancillaryData: string;
  requestTimestamp: string;
}

export interface PolymarketWithEventData extends PolymarketMarketWithAncillaryData {
  txHash: string;
  requester: string;
  proposer: string;
  timestamp: string;
  expirationTimestamp: number;
  eventTimestamp: number;
  eventBlockNumber: number;
  eventIndex: number;
  proposalTimestamp: number;
  identifier: string;
  ancillaryData: string;
  proposedPrice: string;
}

export type PolymarketWithOrderbook = PolymarketWithEventData & MarketOrderbooks;

export interface PolymarketWithOrderbookAndTradeInfo extends PolymarketWithOrderbook {
  orderFilledEvents: [TradeInformation[], TradeInformation[]];
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
  requestTimestamp: string;
}

export const formatPriceEvents = async (
  events: ProposePriceEvent[]
): Promise<
  {
    txHash: string;
    requester: string;
    proposer: string;
    timestamp: string;
    eventTimestamp: number;
    eventBlockNumber: number;
    expirationTimestamp: number;
    proposalTimestamp: number;
    identifier: string;
    ancillaryData: string;
    proposedPrice: string;
    eventIndex: number;
    oracleAddress: string;
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
        timestamp: event.args.timestamp.toString(),
        eventTimestamp: block.timestamp,
        eventBlockNumber: event.blockNumber,
        expirationTimestamp: event.args.expirationTimestamp.toNumber(),
        proposalTimestamp: event.args.expirationTimestamp.toNumber() - ooDefaultLiveness,
        identifier: event.args.identifier,
        ancillaryData: event.args.ancillaryData,
        proposedPrice: ethers.utils.formatEther(event.args.proposedPrice),
        eventIndex: event.logIndex,
        oracleAddress: event.address,
      };
    })
  );
};

export const getPolymarketMarkets = async (params: MonitoringParams): Promise<PolymarketMarket[]> => {
  const markets = [];
  const pagination = 100;
  let offset = 0;

  const whereClause =
    "uma_resolution_status!='settled'" +
    " AND uma_resolution_status!='resolved'" +
    " AND question_ID IS NOT NULL" +
    " AND clob_Token_Ids IS NOT NULL";

  let moreMarketsAvailable = true;
  while (moreMarketsAvailable) {
    const query = `
      {
        markets(where: "${whereClause}", limit: ${pagination}, offset: ${offset}) {
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
          umaResolutionStatus
        }
      }
    `;

    const { markets: polymarketContracts } = (await request(params.graphqlEndpoint, query)) as {
      markets: PolymarketMarketGraphql[];
    };

    // Remove markets with 1 week old endDate or more. So we only monitor markets that ended in the last week
    // (or are still ongoing).
    const now = Math.floor(Date.now() / 1000);
    const oneWeek = 60 * 60 * 24 * 7;

    const filtered = polymarketContracts.filter((contract) => {
      const parsedDateTime = new Date(contract.endDate).getTime();
      if (isNaN(parsedDateTime)) return true; // If endDate is not a valid date we keep the market.
      const endDate = parsedDateTime / 1000;
      return endDate > now - oneWeek;
    });

    // Add retrieved markets to the results array
    markets.push(
      ...filtered.map((contract) => ({
        ...contract,
        outcomes: JSON.parse(contract.outcomes),
        outcomePrices: JSON.parse(contract.outcomePrices),
        clobTokenIds: JSON.parse(contract.clobTokenIds),
      }))
    );

    // Check if more markets are available
    if (polymarketContracts.length < pagination) {
      moreMarketsAvailable = false;
    } else {
      offset += pagination;
    }
  }

  return markets;
};

const getTradeInfoFromOrderFilledEvent = async (provider: Provider, event: any): Promise<TradeInformation> => {
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
  markets: PolymarketWithOrderbook[]
): Promise<PolymarketWithOrderbookAndTradeInfo[]> => {
  if (markets.length === 0) return [];

  const ctfExchange = new ethers.Contract(
    params.ctfExchangeAddress,
    require("./abi/ctfExchange.json"),
    params.provider
  );

  const currentBlockNumber = await params.provider.getBlockNumber();
  const maxBlockLookBack = params.maxBlockLookBack;

  return Promise.all(
    markets.map(async (market) => {
      const searchConfig = {
        fromBlock: market.eventBlockNumber,
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
            return [event?.args?.takerAssetId.toString(), event?.args?.makerAssetId.toString()].includes(
              market.clobTokenIds[0]
            );
          })
          .map((event) => getTradeInfoFromOrderFilledEvent(params.provider, event))
      );

      const outcomeTokenTwo = await Promise.all(
        events
          .filter((event) => {
            return [event?.args?.takerAssetId.toString(), event?.args?.makerAssetId.toString()].includes(
              market.clobTokenIds[1]
            );
          })
          .map((event) => getTradeInfoFromOrderFilledEvent(params.provider, event))
      );

      return {
        ...market,
        orderFilledEvents: [outcomeTokenOne, outcomeTokenTwo],
      };
    })
  );
};

export const getMarketsAncillary = async (
  params: MonitoringParams,
  markets: PolymarketMarket[]
): Promise<PolymarketMarketWithAncillaryData[]> => {
  console.log(`Fetching ancillary data for ${markets.length} markets...`);
  const failed = "failed";
  const binaryAdapterAbi = require("./abi/binaryAdapter.json");
  const ctfAdapterAbi = require("./abi/ctfAdapter.json");
  const ctfAdapterV2Abi = require("./abi/ctfAdapterV2.json");
  const binaryAdapter = new ethers.Contract(params.binaryAdapterAddress, binaryAdapterAbi, params.provider);
  const ctfAdapter = new ethers.Contract(params.ctfAdapterAddress, ctfAdapterAbi, params.provider);
  const ctfAdapterV2 = new ethers.Contract(params.ctfAdapterAddressV2, ctfAdapterV2Abi, params.provider);
  const decoder = TransactionDataDecoder.getInstance();

  // Manually add polymarket abi to the abi decoder global so aggregateTransactionsAndCall will return the correctly decoded data.
  decoder.abiDecoder.addABI(binaryAdapterAbi);
  decoder.abiDecoder.addABI(ctfAdapterAbi);

  const multicall = await getContractInstanceWithProvider<Multicall3Ethers>("Multicall3", params.provider);

  const calls = markets.map((market) => {
    const adapter =
      market.resolvedBy === params.binaryAdapterAddress
        ? binaryAdapter
        : market.resolvedBy === params.ctfAdapterAddressV2
        ? ctfAdapterV2
        : ctfAdapter;
    return {
      target: adapter.address,
      callData: adapter.interface.encodeFunctionData("questions", [market.questionID]),
    };
  });

  const rpcUrl =
    process.env[`NODE_URL_${params.chainId}`] || JSON.parse(process.env[`NODE_URLS_${params.chainId}`] || "[]")[0];
  if (!rpcUrl) throw new Error(`NODE_URL_${params.chainId} or NODE_URLS_${params.chainId} not found in env`);

  const web3Provider = new Web3.providers.HttpProvider(rpcUrl);
  const web3 = new Web3(web3Provider);

  // batch call to multicall contract
  const chunkSize = 25;
  const chunks = [];
  for (let i = 0; i < calls.length; i += chunkSize) {
    chunks.push(calls.slice(i, i + chunkSize));
  }

  const ancillaryMap = new Map<
    string,
    {
      ancillaryData: string;
      requestTimestamp: string;
    }
  >();

  const chunkPromises = chunks.map(async (chunk, i) => {
    try {
      const chunkResults = (await aggregateTransactionsAndCall(multicall.address, web3, chunk)) as {
        ancillaryData: string;
        requestTimestamp: BigNumber;
      }[];
      // Update the ancillaryMap and results with the chunkResults
      chunkResults.forEach((result, index) => {
        const market = markets[i * chunkSize + index];
        ancillaryMap.set(market.questionID, {
          ancillaryData: result.ancillaryData,
          requestTimestamp: result.requestTimestamp.toString(),
        });
      });
    } catch (error) {
      for (let j = 0; j < chunk.length; j++) {
        const call = chunk[j];
        const market = markets[i * chunkSize + j];
        let ancillaryData, requestTimestamp;
        try {
          const adapter = market.resolvedBy === params.binaryAdapterAddress ? binaryAdapter : ctfAdapter;
          const result = await adapter.callStatic.questions(market.questionID);
          ancillaryData = result.ancillaryData;
          requestTimestamp = result.requestTimestamp.toString();
        } catch {
          ancillaryData = failed;
          console.error("Failed to get ancillary data for market ", JSON.stringify(call), JSON.stringify(market));
        }
        ancillaryMap.set(market.questionID, {
          ancillaryData,
          requestTimestamp,
        });
      }
    }
  });

  await Promise.all(chunkPromises);

  console.log("Finished fetching ancillary data for markets...");
  return markets.map((market) => {
    return {
      ...market,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      ancillaryData: ancillaryMap.get(market.questionID)!.ancillaryData,
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      requestTimestamp: ancillaryMap.get(market.questionID)!.requestTimestamp,
    };
  });
};

export const getPolymarketOrderBooks = async (
  params: MonitoringParams,
  markets: PolymarketWithEventData[],
  networker: NetworkerInterface
): Promise<PolymarketWithOrderbook[]> => {
  return await Promise.all(
    markets.map(async (market) => {
      const [marketOne, marketTwo] = market.clobTokenIds;
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

      return {
        ...market,
        ...{
          orderBooks: [
            {
              bids: stringToNumber(outcome1Bids),
              asks: stringToNumber(outcome1Asks),
            },
            {
              bids: stringToNumber(outcome2Bids),
              asks: stringToNumber(outcome2Asks),
            },
          ],
        },
      };
    })
  );
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

  // Creating provider will check for other chainId specific env variables.
  const provider = getRetryProvider(chainId) as Provider;

  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  const maxBlockLookBack = env.MAX_BLOCK_LOOK_BACK ? Number(env.MAX_BLOCK_LOOK_BACK) : 3499;

  return {
    binaryAdapterAddress,
    ctfAdapterAddress,
    ctfAdapterAddressV2,
    ctfExchangeAddress,
    maxBlockLookBack,
    graphqlEndpoint,
    apiEndpoint,
    provider,
    chainId,
    pollingDelay,
  };
};

export const getUnknownProposalKeyData = (question: string): MarketKeyStoreData & { requestTimestamp: string } => ({
  txHash: "unknown",
  question: question,
  proposedPrice: "unknown",
  requestTimestamp: "unknown",
});

export const getMarketKeyToStore = (market: MarketKeyStoreData & { requestTimestamp?: string }): string => {
  return market.txHash + "_" + market.question + "_" + market.proposedPrice + "_" + (market.requestTimestamp || "");
};

export const storeNotifiedProposals = async (
  notifiedContracts: { txHash: string; question: string; proposedPrice: string; requestTimestamp: string }[]
): Promise<void> => {
  const currentTime = new Date().getTime();
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
