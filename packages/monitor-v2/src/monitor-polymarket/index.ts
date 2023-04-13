import { delay } from "@uma/financial-templates-lib";
import { BotModes, initMonitoringParams, Logger, startupLogLevel, waitNextBlockRange } from "./common";
import { monitorTransactionsProposedOrderBook } from "./MonitorProposalsOrderBook";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);
  const cache = { ancillaryData: new Map<string, string>() };

  logger[startupLogLevel(params)]({
    at: "PolymarketMonitor",
    message: "Polymarket Monitor started 🔭",
    botModes: params.botModes,
  });

  const cmds = {
    transactionsProposedEnabled: monitorTransactionsProposedOrderBook,
  };

  for (;;) {
    // In case of non-zero polling delay waitNextBlockRange at the end of the loop could have returned the starting block
    // to be greater than the ending block if there were no new blocks in the last polling delay. In this case we should
    // wait for the next block range before running the commands.
    if (params.blockRange.start > params.blockRange.end) {
      // In serverless it is possible for start block to be larger than end block if no new blocks were mined since last run.
      if (params.pollingDelay === 0) {
        await delay(5); // Set a delay to let the transports flush fully.
        break;
      }
      params.blockRange = await waitNextBlockRange(params);
      continue;
    }

    const runCmds = Object.entries(cmds)
      .filter(([mode]) => params.botModes[mode as keyof BotModes])
      .map(([, cmd]) => cmd(logger, params, cache));

    await Promise.all(runCmds);

    // If polling delay is 0 then we are running in serverless mode and should exit after one iteration.
    if (params.pollingDelay === 0) {
      await delay(5); // Set a delay to let the transports flush fully.
      break;
    }
    params.blockRange = await waitNextBlockRange(params);
  }
}

main().then(
  () => {
    process.exit(0);
  },
  async (error) => {
    logger.error({
      at: "OOv3Monitor",
      message: "Optimistic Oracle V3 Monitor execution error🚨",
      error,
    });
    await delay(5); // Wait 5 seconds to allow logger to flush.
    process.exit(1);
  }
);
