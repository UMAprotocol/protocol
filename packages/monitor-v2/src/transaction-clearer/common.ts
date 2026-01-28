export { Logger } from "@uma/financial-templates-lib";
import { BaseMonitoringParams, initBaseMonitoringParams, startupLogLevel as baseStartup } from "../bot-utils/base";
import { getNonceBacklogConfig, NonceBacklogConfig } from "../bot-utils/transactionClearing";

export interface MonitoringParams extends BaseMonitoringParams {
  nonceBacklogConfig: NonceBacklogConfig;
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const base = await initBaseMonitoringParams(env);

  return {
    ...base,
    nonceBacklogConfig: getNonceBacklogConfig(env),
  };
};

export const startupLogLevel = baseStartup;
