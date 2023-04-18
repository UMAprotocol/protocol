import { delay } from "@uma/financial-templates-lib";
import { initMonitoringParams, Logger } from "./common";
import { monitorTransactionsProposedOrderBook } from "./MonitorProposalsOrderBook";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger.debug({
    at: "PolymarketMonitor",
    message: "Polymarket Monitor started 🔭",
  });

  for (;;) {
    await monitorTransactionsProposedOrderBook(logger, params);

    // If polling delay is 0 then we are running in serverless mode and should exit after one iteration.
    if (params.pollingDelay === 0) {
      await delay(5); // Set a delay to let the transports flush fully.
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
      at: "PolymarketNotifier",
      message: "Polymarket Notifier execution error 🚨",
      error,
    });
    await delay(5); // Wait 5 seconds to allow logger to flush.
    process.exit(1);
  }
);
