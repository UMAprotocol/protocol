import { getMnemonicSigner, getRetryProvider } from "@uma/common";
import { Signer } from "ethers";

import type { Provider } from "@ethersproject/abstract-provider";

export { OptimisticOracleV3Ethers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

export interface BotModes {
  settleAssertionsEnabled: boolean;
}

export interface BlockRange {
  start: number;
  end: number;
}

export interface MonitoringParams {
  provider: Provider;
  chainId: number;
  runFrequency: number;
  botModes: BotModes;
  signer: Signer;
  warmingUpBlockLookback: number;
  blockLookback: number;
  maxBlockLookBack: number;
  firstRun?: boolean;
}

const blockDefaults = {
  "1": {
    // Mainnet
    day: 7200, // 12 seconds per block
    month: 216000,
    maxBlockLookBack: 20000,
  },
  "137": {
    // Polygon
    day: 43200, // 2 seconds per block
    month: 1296000,
    maxBlockLookBack: 3499,
  },
  "10": {
    // Optimism
    day: 43200, // 2 seconds per block
    month: 1296000,
    maxBlockLookBack: 10000,
  },
  "42161": {
    // Arbitrum
    day: 5760, // 15 seconds per block
    month: 172800,
    maxBlockLookBack: 10000,
  },
  "43114": {
    // Avalanche
    day: 43200, // 2 seconds per block
    month: 1296000,
    maxBlockLookBack: 2000,
  },
  other: {
    day: 5760, // assume 15 seconds per block in rest of chains
    month: 172800,
    maxBlockLookBack: 1000,
  },
};

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  // Creating provider will check for other chainId specific env variables.
  const provider = getRetryProvider(chainId) as Provider;

  // Throws if MNEMONIC env var is not defined.
  const signer = (getMnemonicSigner() as Signer).connect(provider);

  // Default to 1 minute run frequency.
  const runFrequency = env.RUN_FREQUENCY ? Number(env.RUN_FREQUENCY) : 60;

  const botModes = {
    settleAssertionsEnabled: env.SETTLEMENTS_ENABLED === "true",
  };

  const blockLookback =
    Number(env.WARMING_UP_BLOCK_LOOKBACK) ||
    blockDefaults[chainId.toString() as keyof typeof blockDefaults]?.day ||
    blockDefaults.other.day;

  const warmingUpBlockLookback =
    Number(env.BLOCK_LOOKBACK) ||
    blockDefaults[chainId.toString() as keyof typeof blockDefaults]?.month ||
    blockDefaults.other.month;

  const maxBlockLookBack =
    Number(env.MAX_BLOCK_LOOKBACK) ||
    blockDefaults[chainId.toString() as keyof typeof blockDefaults]?.maxBlockLookBack ||
    blockDefaults.other.maxBlockLookBack;

  return {
    provider,
    chainId,
    runFrequency,
    botModes,
    signer,
    warmingUpBlockLookback,
    blockLookback,
    maxBlockLookBack,
  };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return params.runFrequency === 0 ? "debug" : "info";
};
