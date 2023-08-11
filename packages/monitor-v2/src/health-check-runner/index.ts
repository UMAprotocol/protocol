import { exec, ExecException } from "child_process";
import { AugmentedLogger, Logger, delay, waitForLogger } from "@uma/financial-templates-lib";

let logger: AugmentedLogger;

export async function run(): Promise<void> {
  logger = Logger;

  logger.debug({ at: "HealthCheckRunner", message: "Health check runner started 🩺" });

  const healthCheckCommands = process.env.HEALTH_CHECK_COMMANDS ? JSON.parse(process.env.HEALTH_CHECK_COMMANDS) : [];

  if (healthCheckCommands.length === 0) {
    logger.debug({ at: "HealthCheckRunner", message: "No health check commands to run. Closing" });
    return;
  }

  logger.debug({ at: "HealthCheckRunner", message: "Running health check commands", healthCheckCommands });

  const outputs = await Promise.all(
    healthCheckCommands.map(async (command: string) => execShellCommand(command, process.env))
  );
  const errorOutputs = outputs.filter((output) => output.error);
  const validOutputs = outputs.filter((output) => !output.error);
  const outputLogLevel = errorOutputs.length > 0 ? "error" : "debug";

  logger[outputLogLevel]({
    at: "HealthCheckRunner",
    message: `Health check command ${outputLogLevel == "error" ? "failed 🩺" : "succeeded"}!`,
    validOutputs: validOutputs.map((output) => output.cmd),
    errorOutputs: errorOutputs.map((outputs) => outputs.stderr),
  });

  await delay(5); // Wait for logs to flush.
  await waitForLogger(logger);
}

if (require.main === module) {
  run()
    .then(() => process.exit(0))
    .catch(async (error) => {
      logger.error({ at: "HealthCheckRunner", message: "There was an error in the main entry point!", error });
      await delay(5); // Wait for logs to flush.
      await waitForLogger(logger);
      process.exit(1);
    });
}

export function execShellCommand(
  cmd: string,
  env: NodeJS.ProcessEnv
): Promise<{ cmd: string; error: ExecException | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    exec(cmd, { env }, (error: ExecException | null, stdout: string, stderr: string) => {
      stdout = _stripExecStdOut(stdout);
      stderr = _stripExecStdOut(stderr);
      resolve({ cmd, error, stdout, stderr });
    });
  });
}

// Format stderr outputs.
function _stripExecStdOut(output: string) {
  if (!output) return output;
  /* eslint-disable no-control-regex */
  return output
    .replace(/\r?\n|\r|/g, "") // Remove Line Breaks, Reversing Strings
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, ""); // Remove all ANSI colors/style
}
