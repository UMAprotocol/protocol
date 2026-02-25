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

const DEFAULT_ERROR_MESSAGE_MAX_LENGTH = 1200;
const DEFAULT_ERROR_FIELD_MAX_LENGTH = 256;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…(truncated ${value.length - maxLength} chars)`;
}

function getStringField(
  error: Record<string, unknown>,
  field: string,
  maxLength = DEFAULT_ERROR_FIELD_MAX_LENGTH
): string | undefined {
  const value = error[field];
  return typeof value === "string" ? truncate(value, maxLength) : undefined;
}

function getErrorMessage(error: unknown, maxLength = DEFAULT_ERROR_MESSAGE_MAX_LENGTH): string {
  if (error instanceof Error) return truncate(error.message, maxLength);

  if (typeof error === "string") return truncate(error, maxLength);

  if (error && typeof error === "object") {
    const message = getStringField(error as Record<string, unknown>, "message", maxLength);
    if (message) return message;
    try {
      return truncate(JSON.stringify(error), maxLength);
    } catch {
      return "Unknown object error";
    }
  }

  return String(error);
}

// Avoid logging full Error objects from ethers/rpc failures as they can contain large tx calldata and exceed transport
// limits (e.g. GCP 256KB entry cap).
export function getSettleTxErrorLogFields(error: unknown): Record<string, unknown> {
  const base: Record<string, unknown> = {
    errorMessage: getErrorMessage(error),
  };

  if (!error || typeof error !== "object") return base;

  const typedError = error as Record<string, unknown>;

  if (typeof typedError.code === "string" || typeof typedError.code === "number") base.errorCode = typedError.code;

  const reason = getStringField(typedError, "reason");
  if (reason) base.errorReason = reason;

  const method = getStringField(typedError, "method");
  if (method) base.errorMethod = method;

  const revertData = getStringField(typedError, "revertData");
  if (revertData) base.revertData = revertData;

  return base;
}
