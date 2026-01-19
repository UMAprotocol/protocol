export { Logger } from "@uma/financial-templates-lib";
import { BaseMonitoringParams, initBaseMonitoringParams, startupLogLevel as baseStartup } from "../bot-utils/base";

export interface NonceBacklogConfig {
  // Minimum nonce difference (pending - latest) to trigger clearing
  nonceBacklogThreshold: number;
  // Fee bump percentage per attempt (e.g., 20 means 20% increase)
  feeBumpPercent: number;
  // Max attempts to replace a stuck transaction with increasing fees
  replacementAttempts: number;
}

export interface MonitoringParams extends BaseMonitoringParams {
  nonceBacklogConfig: NonceBacklogConfig;
}

const parsePositiveInt = (value: string | undefined, defaultValue: number, name: string): number => {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new Error(`${name} must be a positive integer, got: ${value}`);
  }
  return parsed;
};

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const base = await initBaseMonitoringParams(env);

  const nonceBacklogConfig: NonceBacklogConfig = {
    nonceBacklogThreshold: parsePositiveInt(env.NONCE_BACKLOG_THRESHOLD, 1, "NONCE_BACKLOG_THRESHOLD"),
    feeBumpPercent: parsePositiveInt(env.FEE_BUMP_PERCENT, 20, "FEE_BUMP_PERCENT"),
    replacementAttempts: parsePositiveInt(env.REPLACEMENT_ATTEMPTS, 3, "REPLACEMENT_ATTEMPTS"),
  };

  return {
    ...base,
    nonceBacklogConfig,
  };
};

export const startupLogLevel = baseStartup;
