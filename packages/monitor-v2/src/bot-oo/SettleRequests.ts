import { Logger, MonitoringParams } from "./common";
import { settleOOv1Requests } from "./SettleOOv1Requests";
import { settleSkinnyOORequests } from "./SettleSkinnyOORequests";
import { settleOOv2Requests } from "./SettleOOv2Requests";

export async function settleRequests(logger: typeof Logger, params: MonitoringParams): Promise<void> {
  logger.debug({
    at: "OracleBot",
    message: `Starting settlement for ${params.oracleType}`,
    oracleAddress: params.contractAddress,
    oracleType: params.oracleType,
  });

  switch (params.oracleType) {
    case "OptimisticOracle":
      return settleOOv1Requests(logger, params);
    case "SkinnyOptimisticOracle":
      return settleSkinnyOORequests(logger, params);
    case "OptimisticOracleV2":
      return settleOOv2Requests(logger, params);
    default:
      throw new Error(`Unsupported oracle type: ${params.oracleType}`);
  }
}
