import { getGckmsSigner, getMnemonicSigner, getRetryProvider } from "@uma/common";
import { Signer, Wallet } from "ethers";

import type { Provider } from "@ethersproject/abstract-provider";

export { OptimisticOracleV3Ethers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

export const ARBITRUM_CHAIN_ID = 42161;
export const OPTIMISM_CHAIN_ID = 10;
export const POLYGON_CHAIN_ID = 137;

export interface BotModes {
  speedUpPricesEnabled: boolean;
}

export interface BlockRange {
  start: number;
  end: number;
}

export interface MonitoringParams {
  chainId: number;
  provider: Provider;
  l2ChainId?: number;
  l2Provider?: Provider;
  botModes: BotModes;
  signer: Signer;
  pollingDelay: number;
  maxBlockLookBack: number;
  blockLookback: number;
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  // Creating provider will check for other chainId specific env variables.
  const provider = getRetryProvider(chainId) as Provider;

  let l2ChainId, l2Provider;
  if (env.L2_CHAIN_ID) {
    l2ChainId = Number(env.L2_CHAIN_ID);
    l2Provider = getRetryProvider(l2ChainId) as Provider;
  }

  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  let signer;
  if (process.env.GCKMS_WALLET) {
    signer = ((await getGckmsSigner()) as Wallet).connect(provider);
  } else {
    // Throws if MNEMONIC env var is not defined.
    signer = (getMnemonicSigner() as Signer).connect(provider);
  }

  const botModes = {
    speedUpPricesEnabled: env.SPEED_UP_ENABLED === "true",
  };

  if (!env.BLOCK_LOOKBACK) throw new Error("BLOCK_LOOKBACK must be defined in env");
  if (!env.MAX_BLOCK_LOOKBACK) throw new Error("MAX_BLOCK_LOOKBACK must be defined in env");

  const blockLookback = Number(env.BLOCK_LOOKBACK);
  const maxBlockLookBack = Number(env.MAX_BLOCK_LOOKBACK);

  return {
    chainId,
    provider,
    botModes,
    signer,
    blockLookback,
    maxBlockLookBack,
    pollingDelay,
    l2ChainId,
    l2Provider,
  };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return params.pollingDelay === 0 ? "debug" : "info";
};
