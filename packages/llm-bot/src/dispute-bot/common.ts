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
  disputeDisputableRequests: boolean;
}

export interface BlockRange {
  start: number;
  end: number;
}

export interface BotParams {
  chainId: number;
  provider: Provider;
  botModes: BotModes;
  signer: Signer;
  blockLookback: number;
  maxBlockLookBack: number;
  pollingDelay: number;
}

export const initBotParams = async (env: NodeJS.ProcessEnv): Promise<BotParams> => {
  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  // Creating provider will check for other chainId specific env variables.
  const provider = getRetryProvider(chainId) as Provider;

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
    disputeDisputableRequests: env.DISPUTE_DISPUTABLE_REQUESTS === "true",
  };

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
  };
};

export const startupLogLevel = (params: BotParams): "debug" | "info" => {
  return params.pollingDelay === 0 ? "debug" : "info";
};
