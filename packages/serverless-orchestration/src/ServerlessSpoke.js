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
const exec = require("child_process").exec;

const { delay, createNewLogger } = require("@uma/financial-templates-lib");

let customLogger;

const waitForLoggerDelay = process.env.WAIT_FOR_LOGGER_DELAY || 5;

// To be used with exec to override the default input output buffer size.
// 1024 * 1024 is the default.
// This is 1024 * 1024 * 8.
const maxBuffer = 8388608;

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

    const execResponse = await _execShellCommand(
      req.body.serverlessCommand,
      processedEnvironmentVariables,
      req.body.strategyRunnerSpoke
    );

    if (execResponse.error) {
      throw execResponse;
    }
    logger.debug({
      at: "ServerlessSpoke",
      message: "Process exited with no error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      execResponse,
    });
    await delay(waitForLoggerDelay); // Wait a few seconds to be sure the the winston logs are processed upstream.

    res.status(200).send({
      message: "Process exited with no error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      execResponse,
    });
  } catch (execResponse) {
    // If there is an error, send a debug log to the winston transport to capture in GCP. We dont want to trigger a
    // `logger.error` here as this will be dealt with one layer up in the Hub implementation.
    logger.debug({
      at: "ServerlessSpoke",
      message: "Process exited with error 🚨",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      jsonBody: req.body,
      execResponse: execResponse instanceof Error ? execResponse.message : execResponse,
    });
    await delay(waitForLoggerDelay); // Wait a few seconds to be sure the the winston logs are processed upstream.
    res.status(500).send({
      message: "Process exited with error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      execResponse: execResponse instanceof Error ? execResponse.message : execResponse,
    });
  }
});

function _execShellCommand(cmd, inputEnv, strategyRunnerSpoke = false) {
  return new Promise((resolve) => {
    const { stdout, stderr } = exec(
      cmd,
      { env: { ...process.env, ...inputEnv }, stdio: "inherit", maxBuffer },
      (error, stdout, stderr) => {
        // The output from the process execution contains punctuation marks and escape chars that should be stripped.
        stdout = _stripExecStdout(stdout, strategyRunnerSpoke);
        stderr = _stripExecStdError(stderr);
        resolve({ error, stdout, stderr });
      }
    );
    stdout.pipe(process.stdout);
    stderr.pipe(process.stderr);
  });
}

// Format stdout outputs. Turns all logs generated while running the script into an array of Json objects.
function _stripExecStdout(output, strategyRunnerSpoke = false) {
  if (!output) return output;
  // Parse the outputs into a json object to get an array of logs. It is possible that the output is not in a parsable
  // form if the spoke was running a process that did not correctly generate a winston log. In this case simply return
  // the stripped output. Note that we use an array to preserve the log ordering.

  try {
    const strippedOutput = _regexStrip(output).replace(/\r?\n|\r/g, ","); // Remove escaped new line chars. Replace with comma between each log output.
    const logsArray = JSON.parse("[" + strippedOutput.substring(0, strippedOutput.length - 1) + "]");
    // If the body contains `strategyRunnerSpoke` return filter to only return the `BotStrategyRunner` logs. This is
    // done to clean up the upstream logs produced by the bots so the serverless hub can still produce meaningful logs
    // while preserving the individual bot execution logs within GCP when using the strategy runner.
    if (strategyRunnerSpoke) return logsArray.filter((logMessage) => logMessage.at == "BotStrategyRunner");
    // extract only the `message` field from each log to reduce how much is sent back to the hub and logged in GCP.
    else return logsArray.map((logMessage) => logMessage["message"]);
  } catch (error) {
    return _regexStrip(output).replace(/\r?\n|\r/g, " "); // Remove escaped new line chars. Replace with space between each log output.
  }
}

// Format stderr outputs.
function _stripExecStdError(output) {
  if (!output) return output;
  return _regexStrip(output)
    .replace(/\r?\n|\r/g, "")
    .replace(/"/g, ""); // Remove escaped new line chars. Replace with no space.
}

// This Regex removes unnasasary punctuation from the logs and formats the output in a digestible fashion.
function _regexStrip(output) {
  return output
    .replace(/\s\s+/g, " ") // Remove tabbed chars.
    .replace(/\\"/g, ""); // Remove escaped quotes.
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
