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
    day: 576,
    month: 17280,
    maxBlockLookBack: 7000,
  },
  "137": {
    // Polygon
    day: 4320,
    month: 129600,
    maxBlockLookBack: 2500,
  },
  "10": {
    // Optimism
    day: 4320,
    month: 129600,
    maxBlockLookBack: 2000,
  },
  "42161": {
    // Arbitrum
    day: 3456,
    month: 103680,
    maxBlockLookBack: 2000,
  },
  "43114": {
    // Avalanche
    day: 864,
    month: 25920,
    maxBlockLookBack: 2000,
  },
  other: {
    day: 1000,
    month: 20000,
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
