/**
 * @notice This script enables Google Cloud Run functions to execute any arbitrary command from the UMA Docker container.
 * Cloud Run provides a privileged REST endpoint that can be called to spin up a Docker container. This endpoint is
 * expected to respond on PORT. Upon receiving a request, this script executes a child process and responds to the
 * REST query with the output of the process execution. The REST query sent to the API is expected to be a POST
 * with a body formatted as: {"cloudRunCommand":<some-command-to-run>, environmentVariables: <env-variable-object>}
 * the some-command-to-run is any execution process. For example to run the monitor bot this could be set to:
 * { "cloudRunCommand":"npx truffle exec ../monitors/index.js --network mainnet_mnemonic" }. `environmentVariables` is
 * optional. If included the child process will have additional parameters appended with these params.
 */

const express = require("express");
const server = express();
server.use(express.json()); // Enables json to be parsed by the express process.
const exec = require("child_process").exec;

const { Logger, waitForLogger } = require("@umaprotocol/financial-templates-lib");
let logger;

server.post("/", async (req, res) => {
  try {
    logger.debug({
      at: "CloudRunSpoke",
      message: "Executing GCP Cloud Run API Call",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      reqBody: req.body
    });
    if (!req.body.cloudRunCommand) {
      throw new Error("Missing cloudRunCommand in json body! At least this param is needed to run the spoke");
    }

    // Iterate over the provided environment variables and ensure that they are all strings. This enables json configs
    // to be passed in the req body and then set as environment variables in the child_process as a string
    let processedEnvironmentVariables = {};

    if (req.body.environmentVariables) {
      Object.keys(req.body.environmentVariables).forEach(key => {
        // All env variables must be a string. If they are not a string (int, object ect) convert them to a string.
        processedEnvironmentVariables[key] =
          typeof req.body.environmentVariables[key] == "string"
            ? req.body.environmentVariables[key]
            : JSON.stringify(req.body.environmentVariables[key]);
      });
    }

    const execResponse = await _execShellCommand(req.body.cloudRunCommand, processedEnvironmentVariables);

    if (execResponse.error) {
      // execResponse is a json object with keys error, stdout and stderr. Convert this into a string for consistent
      // handling between the winston logger and the http response.
      throw new Error(JSON.stringify(execResponse));
    }
    logger.debug({
      at: "CloudRunSpoke",
      message: "Process exited correctly",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      execResponse
    });
    await waitForLogger(logger);

    res.status(200).send({
      message: "Process exited without error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      execResponse
    });
  } catch (error) {
    // If there is an error, send a debug log to the winston transport to capture in GCP. We dont want to trigger a
    // `logger.error` here as this will be dealt with one layer up in the Hub implementation.
    logger.debug({
      at: "CloudRunSpoke",
      message: "Process exited with error 🚨",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      jsonBody: req.body,
      error: typeof error === "string" ? new Error(JSON.stringify(error)) : error
    });
    await waitForLogger(logger);

    res.status(500).send({
      message: "Process exited with error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      error: error instanceof Error ? error.message : JSON.stringify(error) // HTTP response should only contain strings in json
    });
  }
});

function _execShellCommand(cmd, inputEnv) {
  return new Promise(resolve => {
    exec(cmd, { env: { ...process.env, ...inputEnv } }, (error, stdout, stderr) => {
      // The output from the process execution contains a punctuation marks and escape chars that should be stripped.
      stdout = _stripExecOutput(stdout);
      stderr = _stripExecOutput(stderr);
      resolve({ error, stdout, stderr });
    });
  });
}

// This Regex removes unnasasary punctuation from the logs and formats the output in a digestible fashion.
function _stripExecOutput(output) {
  if (!output) return output;
  return output
    .replace(/\r?\n|\r/g, "") // Remove escaped new line chars
    .replace(/\s\s+/g, " ") // Remove tabbed chars
    .replace(/\"/g, ""); // Remove escaped quotes
}

function _getChildProcessIdentifier(req) {
  if (!req.body.environmentVariables) return null;
  return req.body.environmentVariables.BOT_IDENTIFIER || null;
}

// Start the server's async listening process. Enables injection of a logging instance & port for testing.
async function Poll(injectedLogger = Logger, port = 8080) {
  logger = injectedLogger;
  return server.listen(port, () => {
    logger.debug({
      at: "CloudRunSpoke",
      message: "Cloud Run spoke initialized",
      port
    });
  });
}
// If called directly by node, start the Poll process. If imported as a module then do nothing.
if (require.main === module) {
  const port = process.env.PORT;
  Poll(Logger, port).then(() => {}); // Use the default winston logger & env port.
}

server.Poll = Poll;
module.exports = server;
