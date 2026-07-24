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
// An explicit empty array is accepted: an empty exclude list opts Managed OOv2 into settling everything, while an
// empty include list means settle nothing (the include list is exclusive).
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

// Parses SETTLE_INCLUDE_LIST/SETTLE_EXCLUDE_LIST for OOv2 contracts. An empty exclude list is accepted for any oracle
// type and explicitly opts Managed OOv2 into settling everything; an empty include list means "settle nothing",
// which non-OOv2 oracle types cannot honor.
export function parseSettleProposalIdLists(
  env: NodeJS.ProcessEnv,
  oracleType: OracleType
): { settleIncludeList?: Set<string>; settleExcludeList?: Set<string> } {
  const configuredIncludeList = parseProposalIdList(env.SETTLE_INCLUDE_LIST, "SETTLE_INCLUDE_LIST");
  const settleExcludeList = parseProposalIdList(env.SETTLE_EXCLUDE_LIST, "SETTLE_EXCLUDE_LIST");
  if (
    (configuredIncludeList || settleExcludeList?.size) &&
    oracleType !== "OptimisticOracleV2" &&
    oracleType !== "ManagedOptimisticOracleV2"
  )
    throw new Error(
      "SETTLE_INCLUDE_LIST/SETTLE_EXCLUDE_LIST are only supported for OptimisticOracleV2 and ManagedOptimisticOracleV2"
    );

  // Default Managed OOv2 settlement to an empty include list so missing configuration cannot settle every proposal.
  // An explicit empty exclude list remains the opt-in for settling everything.
  const settleIncludeList =
    oracleType === "ManagedOptimisticOracleV2" && configuredIncludeList === undefined && settleExcludeList === undefined
      ? new Set<string>()
      : configuredIncludeList;

  return { settleIncludeList, settleExcludeList };
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
  // Include/exclude lists of proposal event ids ("<txHash>:<logIndex>"). OOv2 contract types only.
  // When settleIncludeList is set, only those proposals are settled (it takes precedence over the exclude list).
  // Otherwise, proposals in settleExcludeList are skipped. Both undefined is invalid for ManagedOptimisticOracleV2.
  settleIncludeList?: Set<string>;
  settleExcludeList?: Set<string>;
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

  const { settleIncludeList, settleExcludeList } = parseSettleProposalIdLists(env, oracleType);

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
    settleExcludeList,
  };
};

export const startupLogLevel = baseStartup;

// Note: Oracle type detection via empty ABI calls is unreliable. Keep explicit ORACLE_TYPE.
