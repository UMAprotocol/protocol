import { delay, waitForLogger, GasEstimator } from "@uma/financial-templates-lib";
import { initMonitoringParams, Logger, startupLogLevel } from "./common";
import { syncOOv3Cache } from "./SyncOOv3Cache";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger[startupLogLevel(params)]({
    at: "OOv3CacheSyncer",
    message: "Optimistic Oracle V3 Cache Syncer started 🤖",
  });

  const gasEstimator = new GasEstimator(logger, undefined, params.chainId, params.provider);

  for (;;) {
    await gasEstimator.update();

    await syncOOv3Cache(logger, params, gasEstimator);

    // If polling delay is 0 then we are running in serverless mode and should exit after one iteration.
    if (params.pollingDelay === 0) {
      await delay(5); // Set a delay to let the transports flush fully.
      await waitForLogger(logger);
      break;
    }

    await delay(params.pollingDelay);
  }
}

main().then(
  () => {
    process.exit(0);
  },
  async (error) => {
    logger.error({
      at: "OOv3CacheSyncer",
      message: "Optimistic Oracle V3 Cache Syncer execution error🚨",
      error,
    });
    // Wait 5 seconds to allow logger to flush.
    await delay(5);
    await waitForLogger(logger);
    process.exit(1);
  }
);
