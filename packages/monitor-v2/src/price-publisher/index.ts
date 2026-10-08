import { delay, waitForLogger, resolvePagerDutyIncident } from "@uma/financial-templates-lib";
import { initMonitoringParams, Logger, startupLogLevel } from "./common";
import { PricePublicationError } from "./PublishPrices";
import { runPricePublisherCycle } from "./RunCycle";

const logger = Logger;
const executionIncidentKey = `price-publisher:${process.env.CHAIN_ID || "unknown"}:execution`;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger[startupLogLevel(params)]({
    at: "PricePublisher",
    message: "Price Publisher started 🤖",
    botModes: params.botModes,
  });

  for (;;) {
    await runPricePublisherCycle(logger, params);
    try {
      await resolvePagerDutyIncident(logger, executionIncidentKey);
    } catch (error) {
      logger.warn({ at: "PricePublisher", message: "Could not resolve execution incident", error });
    }

    if (params.pollingDelay !== 0) {
      await delay(params.pollingDelay);
    } else {
      await delay(5); // Set a delay to let the transports flush fully.
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
    // Individual request failures already emitted keyed incidents. Preserve a failed exit without a duplicate page.
    logger[error instanceof PricePublicationError ? "warn" : "error"]({
      at: "PricePublisher",
      message: "Price Publisher execution error🚨",
      error,
      pagerDutyDedupKey: executionIncidentKey,
    });
    // Wait 5 seconds to allow logger to flush.
    await delay(5);
    await waitForLogger(logger);
    process.exit(1);
  }
);
