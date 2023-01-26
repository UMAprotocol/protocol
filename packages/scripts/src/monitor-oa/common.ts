import { getRetryProvider } from "@uma/common";
import { ERC20Ethers } from "@uma/contracts-node";
import { delay } from "@uma/financial-templates-lib";
import { utils } from "ethers";
import { getContractInstanceWithProvider } from "../utils/contracts";

import type { Provider } from "@ethersproject/abstract-provider";

export interface BotModes {
  assertionsEnabled: boolean;
  disputesEnabled: boolean;
  settlementsEnabled: boolean;
}

export interface BlockRange {
  start: number;
  end: number;
}

export interface MonitoringParams {
  provider: Provider;
  chainId: number;
  blockRange: BlockRange;
  pollingDelay: number;
  botModes: BotModes;
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  if (!chainId || (chainId != 1 && chainId != 5)) throw new Error("This script should be run on mainnet or goerli");

  // Creating provider will check for other chainId specific env variables.
  const provider = getRetryProvider(chainId) as Provider;

  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  if (pollingDelay === 0 && (!env.STARTING_BLOCK_NUMBER || !env.ENDING_BLOCK_NUMBER)) {
    throw new Error("Must provide STARTING_BLOCK_NUMBER and ENDING_BLOCK_NUMBER if running serverless");
  }

  // If no block numbers are provided, default to the latest block.
  const latestBlockNumber: number = await provider.getBlockNumber();
  const startingBlock = env.STARTING_BLOCK_NUMBER ? Number(env.STARTING_BLOCK_NUMBER) : latestBlockNumber;
  const endingBlock = env.ENDING_BLOCK_NUMBER ? Number(env.ENDING_BLOCK_NUMBER) : latestBlockNumber;
  if (startingBlock > endingBlock) {
    throw new Error("STARTING_BLOCK_NUMBER must be less than or equal to ENDING_BLOCK_NUMBER");
  }

  const botModes = {
    assertionsEnabled: env.ASSERTIONS_ENABLED === "true",
    disputesEnabled: env.DISPUTES_ENABLED === "true",
    settlementsEnabled: env.SETTLEMENTS_ENABLED === "true",
  };

  return {
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
