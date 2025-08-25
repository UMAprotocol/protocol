import type { Provider } from "@ethersproject/abstract-provider";
import { Contract } from "ethers";

export { OptimisticOracleEthers, OptimisticOracleV2Ethers, SkinnyOptimisticOracleEthers } from "@uma/contracts-node";
export { Logger } from "@uma/financial-templates-lib";
export { getContractInstanceWithProvider } from "../utils/contracts";
export { computeEventSearch } from "../bot-utils/events";
import { BaseMonitoringParams, initBaseMonitoringParams, startupLogLevel as baseStartup } from "../bot-utils/base";

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

export const detectOracleType = async (contractAddress: string, provider: Provider): Promise<OracleType> => {
  const contract = new Contract(contractAddress, [], provider);

  try {
    const code = await provider.getCode(contractAddress);
    if (code === "0x") {
      throw new Error(`No contract found at address ${contractAddress}`);
    }

    const hasRequestPrice = await contract.functions.requestPrice?.call?.({}).catch(() => false);

    if (hasRequestPrice) {
      const hasSettle = await contract.functions.settle?.call?.({}).catch(() => false);
      if (hasSettle) {
        try {
          await contract.functions.defaultLiveness?.call?.({});
          return "OptimisticOracleV2";
        } catch {
          try {
            await contract.functions.liveness?.call?.({});
            return "SkinnyOptimisticOracle";
          } catch {
            return "OptimisticOracle";
          }
        }
      }
    }

    throw new Error(`Contract at ${contractAddress} does not appear to be a supported Oracle type`);
  } catch (error) {
    throw new Error(`Failed to detect Oracle type for ${contractAddress}: ${error}`);
  }
};
