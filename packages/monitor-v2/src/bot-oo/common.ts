export { OptimisticOracleEthers, OptimisticOracleV2Ethers, SkinnyOptimisticOracleEthers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { computeEventSearch } from "../bot-utils/events";
export { getContractInstanceWithProvider } from "../utils/contracts";
import { BaseMonitoringParams, startupLogLevel as baseStartup, initBaseMonitoringParams } from "../bot-utils/base";

export type OracleType = "OptimisticOracle" | "SkinnyOptimisticOracle" | "OptimisticOracleV2";

export interface BotModes {
  settleRequestsEnabled: boolean;
}

export interface MonitoringParams extends BaseMonitoringParams {
  botModes: BotModes;
  oracleType: OracleType;
  contractAddress: string;
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  const base = await initBaseMonitoringParams(env);

  const botModes = {
    settleRequestsEnabled: env.SETTLEMENTS_ENABLED === "true",
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

  return {
    ...base,
    botModes,
    oracleType,
    contractAddress,
  };
};

export const startupLogLevel = baseStartup;

// Note: Oracle type detection via empty ABI calls is unreliable. Keep explicit ORACLE_TYPE.
