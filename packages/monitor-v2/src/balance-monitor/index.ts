import { delay, Logger, waitForLogger } from "@uma/financial-templates-lib";

import { initMonitoringParams } from "./common";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger.debug({
    at: "BalanceMonitor",
    message: "Balance Monitor started 🔭",
  });

  for (;;) {
    await params.balanceMonitor.checkBalances(logger);

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
      at: "BalanceMonitor",
      message: "Balance Monitor execution error 🚨",
      error,
      notificationPath: "infrastructure-error",
    });
    await delay(5); // Wait 5 seconds to allow logger to flush.
    await waitForLogger(logger);
    process.exit(1);
  }
);
