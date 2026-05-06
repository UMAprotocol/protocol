export { OptimisticOracleEthers, OptimisticOracleV2Ethers, SkinnyOptimisticOracleEthers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { computeEventSearch } from "../bot-utils/events";
export { getContractInstanceWithProvider } from "../utils/contracts";
import { BaseMonitoringParams, startupLogLevel as baseStartup, initBaseMonitoringParams } from "../bot-utils/base";

export type OracleType = "OptimisticOracle" | "SkinnyOptimisticOracle" | "OptimisticOracleV2";

const DEFAULT_SETTLE_MIN_PROPOSAL_AGE_SECONDS = 2 * 60 * 60 + 15 * 60;

function getNonNegativeNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : defaultValue;
}

export interface BotModes {
  settleRequestsEnabled: boolean;
  settleOnlyDisputed: boolean; // Supported for OptimisticOracleV2 (incl. ManagedOOv2); ignored for OOv1 and SkinnyOO.
}

export interface MonitoringParams extends BaseMonitoringParams {
  botModes: BotModes;
  oracleType: OracleType;
  contractAddress: string;
  settleableCheckBlock: number; // Block number to check for settleable requests, defaults to 5 minutes ago
  executionDeadline?: number; // Timestamp in sec for when to stop settling, defaults to 4 minutes from now in serverless
  settleBatchSize: number; // Number of settle calls to batch via multicall (requires MultiCaller on contract), defaults to 1
  settleMinProposalAgeSeconds: number; // Minimum proposal age before settlement, defaults to 2h15m
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const base = await initBaseMonitoringParams(env);

  const botModes = {
    settleRequestsEnabled: env.SETTLEMENTS_ENABLED === "true",
    settleOnlyDisputed: env.SETTLE_ONLY_DISPUTED === "true",
  };

  if (!env.ORACLE_ADDRESS) throw new Error("ORACLE_ADDRESS must be defined in env");
  const contractAddress = env.ORACLE_ADDRESS;

  if (!env.ORACLE_TYPE)
    throw new Error(
      "ORACLE_TYPE must be defined in env (OptimisticOracle, SkinnyOptimisticOracle, or OptimisticOracleV2)"
    );
  const oracleType = env.ORACLE_TYPE as OracleType;

  if (!["OptimisticOracle", "SkinnyOptimisticOracle", "OptimisticOracleV2"].includes(oracleType)) {
    throw new Error(
      `Invalid ORACLE_TYPE: ${oracleType}. Must be OptimisticOracle, SkinnyOptimisticOracle, or OptimisticOracleV2`
    );
  }

  const settleDelay = Number(env.SETTLE_DELAY) || 5 * 60; // Default to 5 minutes ago
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const settleableCheckBlock = (await base.blockFinder.getBlockForTimestamp(currentTimestamp - settleDelay)).number;

  const settleTimeout = Number(env.SETTLE_TIMEOUT) || 4 * 60; // Default to 4 minutes from now in serverless
  const executionDeadline = base.pollingDelay === 0 ? currentTimestamp + settleTimeout : undefined;

  const settleBatchSize = Math.max(1, Number(env.SETTLE_BATCH_SIZE) || 1);
  const settleMinProposalAgeSeconds = getNonNegativeNumber(
    env.SETTLE_MIN_PROPOSAL_AGE_SECONDS,
    DEFAULT_SETTLE_MIN_PROPOSAL_AGE_SECONDS
  );

  return {
    ...base,
    botModes,
    oracleType,
    contractAddress,
    settleableCheckBlock,
    executionDeadline,
    settleBatchSize,
    settleMinProposalAgeSeconds,
  };
};

export const startupLogLevel = baseStartup;

// Note: Oracle type detection via empty ABI calls is unreliable. Keep explicit ORACLE_TYPE.
