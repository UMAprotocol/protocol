import { getRetryProvider } from "@uma/common";
import { ERC20Ethers, MulticallMakerDaoEthers } from "@uma/contracts-node";
import {
  delay,
  TransactionDataDecoder,
  aggregateTransactionsAndCall,
  Networker,
  Logger,
} from "@uma/financial-templates-lib";
import { utils } from "ethers";
import { getContractInstanceWithProvider } from "../utils/contracts";

import type { Provider } from "@ethersproject/abstract-provider";
import request from "graphql-request";

import { ethers } from "ethers";

import Web3 from "web3";

export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

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
  proposalTimestamp: number;
  identifier: string;
  ancillaryData: string;
  proposedPrice: string;
}

interface PolymarketMarketWithAncillaryData extends PolymarketMarket {
  ancillaryData: string;
}

interface PolymarketMarketWithAncillaryDataAndProposalTimestamp extends PolymarketMarketWithAncillaryData {
  proposalTimestamp: number;
}

interface History {
  t: number;
  p: number;
}
interface HistoricPricesPolymarket {
  history: History[];
}

interface PolymarketWithHistoricPrices extends PolymarketMarketWithAncillaryData {
  historicPrices: [number, number];
}

export const getPolymarketMarkets = async (params: MonitoringParams): Promise<PolymarketMarket[]> => {
  const sevenDays = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 7;
  const whereClause =
    "active = true" +
    " AND question_ID IS NOT NULL" +
    " AND clob_Token_Ids IS NOT NULL" +
    ` AND (resolved_by = '${params.binaryAdapterAddress}' OR resolved_by = '${params.ctfAdapterAddress}')` +
    ` AND EXTRACT(EPOCH FROM TO_TIMESTAMP(end_date, 'Month DD, YYYY')) > ${sevenDays}` +
    " AND uma_resolution_status='proposed'";

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rpcUrl = (params.provider as any).connection.url;
  if (rpcUrl.includes("localhost")) {
    rpcUrl = "http://127.0.0.1:9545/";
  }
  const web3Provider = new Web3.providers.HttpProvider("http://127.0.0.1:9545/");
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
  markets: PolymarketMarketWithAncillaryDataAndProposalTimestamp[],
  networker: any
): Promise<PolymarketWithHistoricPrices[]> => {
  return await Promise.all(
    markets.map(async (polymarketContract) => {
      // startTs 24 hours ago
      const startTs = polymarketContract.proposalTimestamp - 3600;
      const endTs = polymarketContract.proposalTimestamp;
      const marketOne = polymarketContract.clobTokenIds[0];
      const marketTwo = polymarketContract.clobTokenIds[1];
      const apiUrlOne = params.apiEndpoint + `/prices-history?startTs=${startTs}&endTs=${endTs}&market=${marketOne}`;
      const apiUrlTwo = params.apiEndpoint + `/prices-history?startTs=${startTs}&endTs=${endTs}&market=${marketTwo}`;
      const { history: outcome1HistoricPrices } = (await networker.getJson(apiUrlOne, {
        method: "get",
      })) as HistoricPricesPolymarket;

      const { history: outcome2HistoricPrices } = (await networker.getJson(apiUrlTwo, {
        method: "get",
      })) as HistoricPricesPolymarket;
      //

      const sortTimestampDescending = (historicPrices: History[]) => {
        return historicPrices.sort((a, b) => {
          return b.t - a.t;
        });
      };

      return {
        ...polymarketContract,
        historicPrices: [
          sortTimestampDescending(outcome1HistoricPrices)[outcome1HistoricPrices.length - 1].p,
          sortTimestampDescending(outcome2HistoricPrices)[outcome1HistoricPrices.length - 1].p,
        ],
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

export const tryHexToUtf8String = (ancillaryData: string): string => {
  try {
    return utils.toUtf8String(ancillaryData);
  } catch (err) {
    return ancillaryData;
  }
};

export const getCurrencyDecimals = async (provider: Provider, currencyAddress: string): Promise<number> => {
  const currencyContract = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, currencyAddress);
  try {
    return await currencyContract.decimals();
  } catch (err) {
    return 18;
  }
};

export const getCurrencySymbol = async (provider: Provider, currencyAddress: string): Promise<string> => {
  const currencyContract = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, currencyAddress);
  try {
    return await currencyContract.symbol();
  } catch (err) {
    // Try to get the symbol as bytes32 (e.g. MKR uses this).
    try {
      const bytes32SymbolIface = new utils.Interface(["function symbol() view returns (bytes32 symbol)"]);
      const bytes32Symbol = await provider.call({
        to: currencyAddress,
        data: bytes32SymbolIface.encodeFunctionData("symbol"),
      });
      return utils.parseBytes32String(bytes32SymbolIface.decodeFunctionResult("symbol", bytes32Symbol).symbol);
    } catch (err) {
      return "";
    }
  }
};
