import { getGckmsSigner, getMnemonicSigner, getRetryProvider } from "@uma/common";
import { Signer, Wallet } from "ethers";

import type { Provider } from "@ethersproject/abstract-provider";

export { OptimisticOracleV3Ethers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";

export const ARBITRUM_CHAIN_ID = 42161;
export const OPTIMISM_CHAIN_ID = 10;
export const POLYGON_CHAIN_ID = 137;
export const BASE_CHAIN_ID = 8453;
export const BLAST_CHAIN_ID = 81457;
export const BLOCKS_WEEK_MAINNET = 50400;
export const MAX_BLOCK_LOOPBACK_MAINNET = 20000;

export interface BotModes {
  publishPricesEnabled: boolean;
  resolvePricesEnabled: boolean;
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
    publishPricesEnabled: env.PUBLISH_ENABLED === "true",
    resolvePricesEnabled: env.RESOLVE_ENABLED === "true",
  };

  const blockLookback = Number(env.BLOCK_LOOKBACK) || BLOCKS_WEEK_MAINNET;

  const maxBlockLookBack = Number(env.MAX_BLOCK_LOOKBACK) || MAX_BLOCK_LOOPBACK_MAINNET;

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
