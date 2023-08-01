import { delay, waitForLogger } from "@uma/financial-templates-lib";
import { BotModes, initMonitoringParams, Logger, startupLogLevel } from "./common";
import { settleAssertions } from "./SettleAssertions";

export {
  AssertionSettledEvent,
  AssertionMadeEvent,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/OptimisticOracleV3";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger[startupLogLevel(params)]({
    at: "OOv3Bot",
    message: "Optimistic Oracle V3 Bot started 🤖",
    botModes: params.botModes,
  });

  const cmds = {
    settleAssertionsEnabled: settleAssertions,
  };

  for (;;) {
    const runCmds = Object.entries(cmds)
      .filter(([mode]) => params.botModes[mode as keyof BotModes])
      .map(([, cmd]) => cmd(logger, { ...params }));

    await Promise.all(runCmds);

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
      at: "OOv3Bot",
      message: "Optimistic Oracle V3 Bot execution error🚨",
      error,
    });
    // Wait 5 seconds to allow logger to flush.
    await delay(5);
    await waitForLogger(logger);
    process.exit(1);
  }
);
