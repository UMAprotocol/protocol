import type { Logger as LoggerType } from "winston";
import { GasEstimator } from "@uma/financial-templates-lib";
import { MonitoringParams } from "./common";
import { clearStuckTransactions as clearStuckTransactionsImpl } from "../bot-utils/transactionClearing";

export async function clearStuckTransactions(
  logger: LoggerType,
  params: MonitoringParams,
  gasEstimator: GasEstimator
): Promise<void> {
  await clearStuckTransactionsImpl(logger, params, gasEstimator);
}
