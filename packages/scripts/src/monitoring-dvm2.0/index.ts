import { delay, Logger } from "@uma/financial-templates-lib";
import { initCommonEnvVars, updateBlockRange, startupLogLevel } from "./common";
import { monitorUnstakes } from "./MonitorUnstakes";
import { monitorStakes } from "./MonitorStakes";
import { monitorGovernance } from "./MonitorGovernance";
import { monitorDeletion } from "./MonitorDeletion";
import { monitorEmergency } from "./MonitorEmergency";
import { monitorRolled } from "./MonitorRolled";

const logger = Logger;

async function main() {
  const params = await initCommonEnvVars(process.env);

  logger[startupLogLevel(params)]({ at: "DMVMonitor", message: "DVM Monitor started 🔭", botModes: params.botModes });

  const cmds = {
    unstakesEnabled: monitorUnstakes,
    stakesEnabled: monitorStakes,
    governanceEnabled: monitorGovernance,
    deletionEnabled: monitorDeletion,
    emergencyEnabled: monitorEmergency,
    rolledEnabled: monitorRolled,
  };

  for (;;) {
    if (params.startingBlock > params.endingBlock) {
      await updateBlockRange(params);
      continue;
    }

    const runCmds = Object.entries(cmds)
      .filter(([mode]) => params.botModes[mode])
      .map(([, cmd]) => cmd(logger, params));

    await Promise.all(runCmds);

    if (params.pollingDelay === 0) break;
    await delay(Number(params.pollingDelay));
    await updateBlockRange(params);
  }
}

main().then(
  () => {
    process.exit(0);
  },
  async (error) => {
    logger.error({
      at: "DMVMonitor",
      message: "DVM Monitor execution error🚨",
      error,
    });
    await delay(5);
    process.exit(1);
  }
);
