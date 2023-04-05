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
    hour: 300, // 12 seconds per block
    day: 7200,
    maxBlockLookBack: 20000,
  },
  "137": {
    // Polygon
    hour: 1800, // 2 seconds per block
    day: 43200,
    maxBlockLookBack: 3499,
  },
  "10": {
    // Optimism
    hour: 1800, // 2 seconds per block
    day: 43200,
    maxBlockLookBack: 10000,
  },
  "42161": {
    // Arbitrum
    hour: 240, // 15 seconds per block
    day: 5760,
    maxBlockLookBack: 10000,
  },
  "43114": {
    // Avalanche
    hour: 1800, // 2 seconds per block
    day: 43200,
    maxBlockLookBack: 2000,
  },
  other: {
    hour: 240, // 15 seconds per block
    day: 5760,
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
    blockDefaults[chainId.toString() as keyof typeof blockDefaults]?.hour ||
    blockDefaults.other.hour;

  const warmingUpBlockLookback =
    Number(env.BLOCK_LOOKBACK) ||
    blockDefaults[chainId.toString() as keyof typeof blockDefaults]?.day ||
    blockDefaults.other.day;

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
