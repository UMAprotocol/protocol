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

  await monitorTransactionsProposedOrderBook(logger, params);
  await delay(5);
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
