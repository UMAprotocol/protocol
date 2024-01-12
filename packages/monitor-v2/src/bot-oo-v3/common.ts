import { getGckmsSigner, getMnemonicSigner, getRetryProvider } from "@uma/common";
import { BlockFinder } from "@uma/sdk";
import { Signer, Wallet } from "ethers";

import type { Block, Provider } from "@ethersproject/abstract-provider";
import { blockDefaults } from "../utils/constants";

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
  botModes: BotModes;
  signer: Signer;
  timeLookback: number;
  maxBlockLookBack: number;
  blockFinder: BlockFinder<Block>;
  pollingDelay: number;
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
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
    settleAssertionsEnabled: env.SETTLEMENTS_ENABLED === "true",
  };

  const timeLookback = Number(env.TIME_LOOKBACK) || 72 * 60 * 60;

  const maxBlockLookBack =
    Number(env.MAX_BLOCK_LOOKBACK) ||
    blockDefaults[chainId.toString() as keyof typeof blockDefaults]?.maxBlockLookBack ||
    blockDefaults.other.maxBlockLookBack;

  const blockFinder = new BlockFinder(provider.getBlock.bind(provider), undefined, chainId);

  return {
    provider,
    chainId,
    botModes,
    signer,
    timeLookback,
    maxBlockLookBack,
    blockFinder,
    pollingDelay,
  };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return params.pollingDelay === 0 ? "debug" : "info";
};
