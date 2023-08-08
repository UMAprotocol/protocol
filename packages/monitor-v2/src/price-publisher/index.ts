import { delay, waitForLogger } from "@uma/financial-templates-lib";
import { BotModes, initMonitoringParams, Logger, startupLogLevel } from "./common";
import { publishPrices } from "./PublishPrices";
import { resolvePrices } from "./ResolvePrices";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger[startupLogLevel(params)]({
    at: "PricePublisher",
    message: "Price Publisher started 🤖",
    botModes: params.botModes,
  });

  const cmds = {
    resolvePricesEnabled: resolvePrices, // should be run before publishPrices
    publishPricesEnabled: publishPrices,
  };

  for (;;) {
    const runCmds = Object.entries(cmds)
      .filter(([mode]) => params.botModes[mode as keyof BotModes])
      .map(([, cmd]) => cmd(logger, { ...params }));

    for (const cmd of runCmds) {
      await cmd;
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
    logger.error({
      at: "PricePublisher",
      message: "Price Publisher execution error🚨",
      error,
    });
    // Wait 5 seconds to allow logger to flush.
    await delay(5);
    await waitForLogger(logger);
    process.exit(1);
  }
);
