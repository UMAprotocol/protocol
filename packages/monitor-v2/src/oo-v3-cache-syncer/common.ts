import { Multicall } from "@uma/sdk";
import { ethers } from "ethers";
import { BaseMonitoringParams, initBaseMonitoringParams, startupLogLevel as baseStartup } from "../bot-utils/base";

export { Logger } from "@uma/logger";

export interface MonitoringParams extends BaseMonitoringParams {
  multicall: Multicall;
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const base = await initBaseMonitoringParams(env);

  // Default to Ethereum mainnet Multicall3 address
  const multicallAddress = env.MULTICALL_ADDRESS ?? "0xcA11bde05977b3631167028862bE2a173976CA11";
  if (ethers.utils.isAddress(multicallAddress) === false) {
    throw new Error(`Invalid MULTICALL_ADDRESS: ${multicallAddress}`);
  }
  const multicall = new Multicall(multicallAddress, base.provider);
  return {
    ...base,
    multicall,
  };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return baseStartup(params);
};
