import { utils as ethersUtils } from "ethers";
import { isEthersTxRunnerError } from "@uma/common";

function encodeStringError(error: string): string {
  return ethersUtils.hexlify(
    ethersUtils.concat([
      ethersUtils.id("Error(string)").slice(0, 10),
      ethersUtils.defaultAbiCoder.encode(["string"], [error]),
    ])
  );
}

const NOT_SETTLEABLE_REVERTS = [
  // OptimisticOracle, OptimisticOracleV2:
  encodeStringError("_settle: not settleable"),
  // SkinnyOptimisticOracle, SkinnyOptimisticOracleV2:
  encodeStringError("Already settled or not settleable"),
  // OptimisticOracleV3:
  encodeStringError("Assertion already settled"),
  // Upgradeable ManagedOptimisticOracleV2, OptimisticOracleV2:
  ethersUtils.id("RequestNotSettleable()").slice(0, 10),
] as const;

function isNotSettleableError(error: unknown): boolean {
  return isEthersTxRunnerError(error) && NOT_SETTLEABLE_REVERTS.includes(error.revertData);
}

// It is common for settlement transactions to fail due to somebody else settling the request first, and this helper
// would escalate the log level to error only for unexpected errors, while keeping the common case as a warning.
export function getSettleTxErrorLogLevel(error: unknown): "warn" | "error" {
  return isNotSettleableError(error) ? "warn" : "error";
}
