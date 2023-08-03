import { delay, Logger, waitForLogger } from "@uma/financial-templates-lib";
import { initMonitoringParams, startupLogLevel, waitNextBlockRange } from "./common";
import { monitorUnstakes } from "./MonitorUnstakes";
import { monitorStakes } from "./MonitorStakes";
import { monitorGovernance } from "./MonitorGovernance";
import { monitorDeletion } from "./MonitorDeletion";
import { monitorEmergency } from "./MonitorEmergency";
import { monitorRolled } from "./MonitorRolled";
import { monitorGovernorTransfers } from "./MonitorGovernorTransfers";
import { monitorMints } from "./MonitorMints";
import type { BotModes } from "./common";

const logger = Logger;

async function main() {
  const params = await initMonitoringParams(process.env);

  logger[startupLogLevel(params)]({ at: "DVMMonitor", message: "DVM Monitor started 🔭", botModes: params.botModes });

  const cmds = {
    unstakesEnabled: monitorUnstakes,
    stakesEnabled: monitorStakes,
    governanceEnabled: monitorGovernance,
    deletionEnabled: monitorDeletion,
    emergencyEnabled: monitorEmergency,
    rolledEnabled: monitorRolled,
    governorTransfersEnabled: monitorGovernorTransfers,
    mintsEnabled: monitorMints,
  };

  for (;;) {
    // In case of non-zero polling delay waitNextBlockRange at the end of the loop could have returned the starting block
    // to be greater than the ending block if there were no new blocks in the last polling delay. In this case we should
    // wait for the next block range before running the commands.
    if (params.blockRange.start > params.blockRange.end) {
      // In serverless it is possible for start block to be larger than end block if no new blocks were mined since last run.
      if (params.pollingDelay === 0) {
        await delay(5); // Set a delay to let the transports flush fully.
        await waitForLogger(logger);
        break;
      }
      params.blockRange = await waitNextBlockRange(params);
      continue;
    }

    const runCmds = Object.entries(cmds)
      .filter(([mode]) => params.botModes[mode as keyof BotModes])
      .map(([, cmd]) => cmd(logger, params));

    await Promise.all(runCmds);

    // If polling delay is 0 then we are running in serverless mode and should exit after one iteration.
    if (params.pollingDelay === 0) {
      await delay(5); // Set a delay to let the transports flush fully.
      await waitForLogger(logger);
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
      at: "DVMMonitor",
      message: "DVM Monitor execution error🚨",
      error,
    });
    // Wait 5 seconds to allow logger to flush.
    await delay(5);
    await waitForLogger(logger);
    process.exit(1);
  }
);
