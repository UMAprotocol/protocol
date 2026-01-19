import { delay, waitForLogger, GasEstimator } from "@uma/financial-templates-lib";
import { BotModes, initMonitoringParams, Logger, startupLogLevel } from "./common";
import { settleRequests } from "./SettleRequests";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger[startupLogLevel(params)]({
    at: "OracleBot",
    message: `Optimistic Oracle Bot started 🤖`,
    oracleType: params.oracleType,
    oracleAddress: params.contractAddress,
    botModes: params.botModes,
  });

  const gasEstimator = new GasEstimator(logger, undefined, params.chainId, params.provider);

  const cmds = {
    settleRequestsEnabled: settleRequests,
  };

  for (;;) {
    await gasEstimator.update();

    const runCmds = Object.entries(cmds)
      .filter(([mode]) => params.botModes[mode as keyof BotModes])
      .map(([, cmd]) => cmd(logger, { ...params }, gasEstimator));

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
      at: "OracleBot",
      message: "Optimistic Oracle Bot execution error🚨",
      error,
    });
    // Wait 5 seconds to allow logger to flush.
    await delay(5);
    await waitForLogger(logger);
    process.exit(1);
  }
);
