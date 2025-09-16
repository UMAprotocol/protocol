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
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const base = await initBaseMonitoringParams(env);

  const botModes = {
    settleAssertionsEnabled: env.SETTLEMENTS_ENABLED === "true",
  };

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
  };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return baseStartup(params);
};
