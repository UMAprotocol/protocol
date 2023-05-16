import { delay } from "@uma/financial-templates-lib";
import { BotModes, initMonitoringParams, Logger, startupLogLevel } from "./common";
import { speedUpPrices } from "./SpeedUpPriceRequests";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger[startupLogLevel(params)]({
    at: "PriceSpeedUp",
    message: "Price Speed Up started 🤖",
    botModes: params.botModes,
  });

  const cmds = {
    speedUpPricesEnabled: speedUpPrices,
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
      at: "PriceSpeedUp",
      message: "Price Speed Up execution error🚨",
      error,
    });
    // Wait 5 seconds to allow logger to flush.
    await delay(5);
    process.exit(1);
  }
);
