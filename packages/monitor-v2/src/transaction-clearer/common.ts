export { Logger } from "@uma/financial-templates-lib";
import { BaseMonitoringParams, initBaseMonitoringParams, startupLogLevel as baseStartup } from "../bot-utils/base";

export interface NonceBacklogConfig {
  // Minimum nonce difference (pending - latest) to trigger clearing
  nonceBacklogThreshold: number;
  // Fee bump multiplier: bumpedFee = fee * numerator / denominator
  feeBumpNumerator: number;
  feeBumpDenominator: number;
  // Max attempts to replace a stuck transaction with increasing fees
  replacementAttempts: number;
}

export interface MonitoringParams extends BaseMonitoringParams {
  nonceBacklogConfig: NonceBacklogConfig;
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const base = await initBaseMonitoringParams(env);

  const nonceBacklogConfig: NonceBacklogConfig = {
    nonceBacklogThreshold: Number(env.NONCE_BACKLOG_THRESHOLD) || 1,
    feeBumpNumerator: Number(env.FEE_BUMP_NUMERATOR) || 12,
    feeBumpDenominator: Number(env.FEE_BUMP_DENOMINATOR) || 10,
    replacementAttempts: Number(env.REPLACEMENT_ATTEMPTS) || 3,
  };

  return {
    ...base,
    nonceBacklogConfig,
  };
};

export const startupLogLevel = baseStartup;
