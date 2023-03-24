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
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  // Throws if MNEMONIC env var is not defined.
  const signer = getMnemonicSigner() as Signer;

  // Creating provider will check for other chainId specific env variables.
  const provider = getRetryProvider(chainId) as Provider;

  // Default to 1 minute run frequency.
  const runFrequency = env.RUN_FREQUENCY ? Number(env.RUN_FREQUENCY) : 60;

  const botModes = {
    settleAssertionsEnabled: env.SETTLEMENTS_ENABLED === "true",
  };

  return {
    provider,
    chainId,
    runFrequency,
    botModes,
    signer,
  };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return params.runFrequency === 0 ? "debug" : "info";
};
