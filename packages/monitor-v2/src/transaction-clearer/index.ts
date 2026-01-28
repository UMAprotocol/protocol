// Standalone bot for clearing stuck transactions via self-tx replacement.
import { delay, waitForLogger, GasEstimator } from "@uma/financial-templates-lib";
import { initMonitoringParams, Logger, startupLogLevel } from "./common";
import { clearStuckTransactions } from "./TransactionClearer";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger[startupLogLevel(params)]({
    at: "TransactionClearer",
    message: "Transaction Clearer Bot started",
    chainId: params.chainId,
    nonceBacklogConfig: params.nonceBacklogConfig,
  });

  const gasEstimator = new GasEstimator(logger, undefined, params.chainId, params.provider);

  for (;;) {
    await gasEstimator.update();

    try {
      await clearStuckTransactions(logger, params, gasEstimator);
    } catch (error) {
      logger.error({
        at: "TransactionClearer",
        message: "Error clearing stuck transactions",
        error,
      });
    }

    if (params.pollingDelay !== 0) {
      await delay(params.pollingDelay);
    } else {
      await delay(5); // Allow transports to flush
      await waitForLogger(logger);
      break;
    }
  }
}

main().then(
  () => {
    process.exit(0);
  },
  async (error) => {
    logger.error({
      at: "TransactionClearer",
      message: "Transaction Clearer Bot execution error",
      error,
    });
    await delay(5);
    await waitForLogger(logger);
    process.exit(1);
  }
);
