export { OptimisticOracleEthers, OptimisticOracleV2Ethers, SkinnyOptimisticOracleEthers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { computeEventSearch } from "../bot-utils/events";
export { getContractInstanceWithProvider } from "../utils/contracts";
import { BaseMonitoringParams, startupLogLevel as baseStartup, initBaseMonitoringParams } from "../bot-utils/base";
import { proposalEventId } from "./requestKey";

export type OracleType =
  | "OptimisticOracle"
  | "SkinnyOptimisticOracle"
  | "OptimisticOracleV2"
  | "ManagedOptimisticOracleV2";

const DEFAULT_SETTLE_MIN_PROPOSAL_AGE_SECONDS = 2 * 60 * 60 + 15 * 60;

const PROPOSAL_ID_REGEX = /^(0x[0-9a-fA-F]{64}):(\d+)$/;

function getNonNegativeNumber(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : defaultValue;
}

// Parses a JSON array of "<txHash>:<logIndex>" strings into a normalized set of proposal event ids.
// Returns undefined when the env var is unset/blank.
// An explicit empty array is accepted; oracle-specific support is validated separately.
export function parseProposalIdList(value: string | undefined, envName: string): Set<string> | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${envName} must be a JSON array of "<txHash>:<logIndex>" strings`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${envName} must be a JSON array of "<txHash>:<logIndex>" strings`);
  }

  const ids = parsed.map((entry) => {
    if (typeof entry !== "string") throw new Error(`${envName} entries must be "<txHash>:<logIndex>" strings`);
    const match = entry.match(PROPOSAL_ID_REGEX);
    if (!match) throw new Error(`Invalid ${envName} entry "${entry}"; expected "<txHash>:<logIndex>"`);
    return proposalEventId(match[1], Number(match[2]));
  });

  return new Set(ids);
}

// Parses SETTLE_INCLUDE_LIST for OOv2 contracts. For Managed OOv2 it governs non-resolved requests only; normal
// resolved-dispute settlement is always preserved.
export function parseSettleIncludeList(env: NodeJS.ProcessEnv, oracleType: OracleType): Set<string> | undefined {
  // Fail fast on the removed setting so stale deployments cannot silently fall back to settling every proposal.
  if (env.SETTLE_EXCLUDE_LIST !== undefined)
    throw new Error("SETTLE_EXCLUDE_LIST is not supported; use SETTLE_INCLUDE_LIST");

  const configuredIncludeList = parseProposalIdList(env.SETTLE_INCLUDE_LIST, "SETTLE_INCLUDE_LIST");
  if (configuredIncludeList && oracleType !== "OptimisticOracleV2" && oracleType !== "ManagedOptimisticOracleV2")
    throw new Error("SETTLE_INCLUDE_LIST is only supported for OptimisticOracleV2 and ManagedOptimisticOracleV2");

  // Default Managed OOv2 settlement to an empty include list so missing configuration cannot settle non-resolved
  // proposals.
  return oracleType === "ManagedOptimisticOracleV2" && configuredIncludeList === undefined
    ? new Set<string>()
    : configuredIncludeList;
}

export interface BotModes {
  settleRequestsEnabled: boolean;
  settleOnlyDisputed: boolean; // Supported for standard OOv2; ignored for OOv1, SkinnyOO, and Managed OOv2.
}

export interface MonitoringParams extends BaseMonitoringParams {
  botModes: BotModes;
  oracleType: OracleType;
  contractAddress: string;
  settleableCheckBlock: number; // Block number to check for settleable requests, defaults to 5 minutes ago
  executionDeadline?: number; // Timestamp in sec for when to stop settling, defaults to 4 minutes from now in serverless
  settleBatchSize: number; // Number of settle calls to batch via multicall (requires MultiCaller on contract), defaults to 1
  settleMinProposalAgeSeconds: number; // Minimum proposal age before settlement, defaults to 2h15m
  // Proposal event ids ("<txHash>:<logIndex>"). Standard OOv2 applies the include filter to all proposals. Managed
  // OOv2 applies it only to non-resolved proposals; resolved disputes follow normal settlement.
  settleIncludeList?: Set<string>;
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
      "ORACLE_TYPE must be defined in env (OptimisticOracle, SkinnyOptimisticOracle, OptimisticOracleV2, or ManagedOptimisticOracleV2)"
    );
  const oracleType = env.ORACLE_TYPE as OracleType;

  if (
    !["OptimisticOracle", "SkinnyOptimisticOracle", "OptimisticOracleV2", "ManagedOptimisticOracleV2"].includes(
      oracleType
    )
  ) {
    throw new Error(
      `Invalid ORACLE_TYPE: ${oracleType}. Must be OptimisticOracle, SkinnyOptimisticOracle, OptimisticOracleV2, or ManagedOptimisticOracleV2`
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

  const settleIncludeList = parseSettleIncludeList(env, oracleType);

  return {
    ...base,
    botModes,
    oracleType,
    contractAddress,
    settleableCheckBlock,
    executionDeadline,
    settleBatchSize,
    settleMinProposalAgeSeconds,
    settleIncludeList,
  };
};

export const startupLogLevel = baseStartup;

// Note: Oracle type detection via empty ABI calls is unreliable. Keep explicit ORACLE_TYPE.
