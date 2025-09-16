import type { Provider } from "@ethersproject/abstract-provider";

export { OptimisticOracleV3Ethers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";
export { computeEventSearch } from "../bot-utils/events";
import { BaseMonitoringParams, initBaseMonitoringParams, startupLogLevel as baseStartup } from "../bot-utils/base";

export interface BotModes {
  settleAssertionsEnabled: boolean;
}

export interface MonitoringParams {
  provider: Provider;
  chainId: number;
  botModes: BotModes;
  signer: BaseMonitoringParams["signer"];
  timeLookback: number;
  maxBlockLookBack: number;
  blockFinder: BaseMonitoringParams["blockFinder"];
  pollingDelay: number;
  gasLimitMultiplier: number;
  settleableCheckBlock: number; // Block number to check for settleable assertions, defaults to 5 minutes ago
  executionDeadline?: number; // Timestamp in sec for when to stop settling, defaults to 4 minutes from now in serverless
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const base = await initBaseMonitoringParams(env);

  const botModes = {
    settleAssertionsEnabled: env.SETTLEMENTS_ENABLED === "true",
  };

  const settleDelay = Number(env.SETTLE_DELAY) || 5 * 60; // Default to 5 minutes ago
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const settleableCheckBlock = (await base.blockFinder.getBlockForTimestamp(currentTimestamp - settleDelay)).number;

  const settleTimeout = Number(env.SETTLE_TIMEOUT) || 4 * 60; // Default to 4 minutes from now in serverless
  const executionDeadline = base.pollingDelay === 0 ? currentTimestamp + settleTimeout : undefined;

  return {
    provider: base.provider,
    chainId: base.chainId,
    botModes,
    signer: base.signer,
    timeLookback: base.timeLookback,
    maxBlockLookBack: base.maxBlockLookBack,
    blockFinder: base.blockFinder,
    pollingDelay: base.pollingDelay,
    gasLimitMultiplier: base.gasLimitMultiplier,
    settleableCheckBlock,
    executionDeadline,
  };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return baseStartup(params);
};
