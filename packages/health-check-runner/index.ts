const exec = require("child_process").exec;
import { Logger } from "@uma/financial-templates-lib";

let logger;

export async function run(): Promise<void> {
  logger = Logger;

  logger.debug({ at: "HealthCheckRunner", message: "Starting health check runner 🩺" });

  const healthCheckCommands = process.env.HEALTH_CHECK_COMMANDS ? JSON.parse(process.env.HEALTH_CHECK_COMMANDS) : [];

  if (healthCheckCommands.length === 0) {
    logger.debug({ at: "HealthCheckRunner", message: "No health check commands to run. Closing" });
    return;
  }

  logger.debug({ at: "HealthCheckRunner", message: "Running health check commands", healthCheckCommands });

  const outputs = await Promise.all(healthCheckCommands.map(async (command) => execShellCommand(command, process.env)));
  const errorOutputs = outputs.filter((output) => output.error);
  const validOutputs = outputs.filter((output) => !output.error);
  const outputLogLevel = errorOutputs.length > 0 ? "error" : "debug";

  logger[outputLogLevel]({
    at: "HealthCheckRunner",
    message: `Health check command ${outputLogLevel == "error" ? "failed" : "succeeded"}!`,
    validOutputs: validOutputs.map((output) => output.cmd),
    errorOutputs,
  });
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(async (error) => {
      logger.error({ at: "HealthCheckRunner", message: "There was an error in the main entry point!", error });
      process.exit(1);
    });
}

export function execShellCommand(cmd, env) {
  return new Promise((resolve) => {
    const { stdout, stderr } = exec(cmd, { env, stdio: "inherit" }, (error, stdout, stderr) => {
      stdout = _stripExecStdOut(stdout);
      stderr = _stripExecStdOut(stderr);
      resolve({ cmd, error, stdout, stderr });
    });
    stdout.pipe(process.stdout);
    stderr.pipe(process.stderr);
  });
}

// Format stderr outputs.
function _stripExecStdOut(output) {
  if (!output) return output;
  /* eslint-disable no-control-regex */
  return output
    .replace(/\r?\n|\r|/g, "") // Remove Line Breaks, Reversing Strings
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, ""); // Remove all ANSI colors/style
}
