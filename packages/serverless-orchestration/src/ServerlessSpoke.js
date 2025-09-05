/**
 * @notice This script enables serverless functions to execute any arbitrary command from the UMA Docker container.
 * This can be run on a local machine, within GCP cloud run or GCP cloud function environments. Cloud Run provides a
 * privileged REST endpoint that can be called to spin up a Docker container. This endpoint is expected to respond on
 * PORT. Upon receiving a request, this script executes a child process and responds to the  REST query with the output
 * of the process execution. The REST query sent to the API is expected to be a POST with a body formatted as:
 * {"serverlessCommand":<some-command-to-run>, environmentVariables: <env-variable-object>}
 * the some-command-to-run is any execution process within the UMA docker container. For example to run the monitor bot
 * this could be set to:  { "serverlessCommand":"yarn --silent monitors --network mainnet_mnemonic" }. `environmentVariables` is
 * optional. If included the child process will have additional parameters appended with these params.
 */

const express = require("express");
const spoke = express();
spoke.use(express.json()); // Enables json to be parsed by the express process.
const spawn = require("child_process").spawn;

const { delay, createNewLogger } = require("@uma/logger");

let customLogger;

const waitForLoggerDelay = process.env.WAIT_FOR_LOGGER_DELAY || 5;

spoke.post("/", async (req, res) => {
  // Use a custom logger if provided. Otherwise, initialize a local logger with a run identifier if passed from the Hub.
  // Note: no reason to put this into the try-catch since a logger is required to throw the error.
  const logger =
    customLogger || createNewLogger(undefined, undefined, undefined, req.body?.environmentVariables?.RUN_IDENTIFIER);
  try {
    logger.debug({
      at: "ServerlessSpoke",
      message: "Executing serverless spoke call",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      reqBody: req.body,
    });
    if (!req.body.serverlessCommand) {
      throw new Error("Missing serverlessCommand in json body! At least this param is needed to run the spoke");
    }

    // Iterate over the provided environment variables and ensure that they are all strings. This enables json configs
    // to be passed in the req body and then set as environment variables in the child_process as a string
    let processedEnvironmentVariables = {};

    if (req.body.environmentVariables) {
      Object.keys(req.body.environmentVariables).forEach((key) => {
        // All env variables must be a string. If they are not a string (int, object ect) convert them to a string.
        processedEnvironmentVariables[key] =
          typeof req.body.environmentVariables[key] == "string"
            ? req.body.environmentVariables[key]
            : JSON.stringify(req.body.environmentVariables[key]);
      });
    }

    await _execShellCommand(req.body.serverlessCommand, processedEnvironmentVariables, req.body.strategyRunnerSpoke);

    logger.debug({
      at: "ServerlessSpoke",
      message: "Process exited with no error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
    });
    await delay(waitForLoggerDelay); // Wait a few seconds to be sure the the winston logs are processed upstream.

    res.status(200).send({
      message: "Process exited with no error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      success: true,
    });
  } catch (execResponse) {
    // If there is an error, send a debug log to the winston transport to capture in GCP. We dont want to trigger a
    // `logger.error` here as this will be dealt with one layer up in the Hub implementation.
    logger.debug({
      at: "ServerlessSpoke",
      message: "Process exited with error 🚨",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      jsonBody: req.body,
      error: execResponse instanceof Error ? execResponse.message : execResponse,
    });
    await delay(waitForLoggerDelay); // Wait a few seconds to be sure the the winston logs are processed upstream.
    res.status(500).send({
      message: "Process exited with error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      error: execResponse instanceof Error ? execResponse.message : execResponse,
    });
  }
});

function _execShellCommand(cmd, inputEnv) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [], { env: { ...process.env, ...inputEnv }, stdio: "pipe", shell: true });

    // Wait for the process to exit to resolve the promise.
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else if (code !== null) {
        // Process exited on its own with a non-zero exit code.
        reject(new Error(`Process exited with code ${code}`));
      } else {
        // Process exited because of a signal.
        reject(new Error(`Process exited with signal ${signal}`));
      }
    });

    // Pipe the stdout and stderr to the parent process.
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
  });
}

function _getChildProcessIdentifier(req) {
  if (!req.body.environmentVariables) return null;
  return req.body.environmentVariables.BOT_IDENTIFIER || null;
}

// Start the spoke's async listening process. Enables injection of a logging instance & port for testing.
async function Poll(_customLogger, port = 8080) {
  customLogger = _customLogger;
  // Use custom logger if passed in. Otherwise, create a local logger.
  const logger = customLogger || createNewLogger();
  return spoke.listen(port, () => {
    logger.debug({ at: "ServerlessSpoke", message: "serverless spoke initialized", port, env: process.env });
  });
}
// If called directly by node, start the Poll process. If imported as a module then do nothing.
if (require.main === module) {
  Poll(null, process.env.PORT).then(() => {}); // Use the default winston logger & env port.
}

spoke.Poll = Poll;
module.exports = spoke;
