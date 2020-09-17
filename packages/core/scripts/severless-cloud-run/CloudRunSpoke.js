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
const spoke = express();
spoke.use(express.json()); // Enables json to be parsed by the express process.
const exec = require("child_process").exec;

const { Logger } = require("@uma/financial-templates-lib");
let logger;

spoke.post("/", async (req, res) => {
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
      throw execResponse;
    }
    logger.debug({
      at: "CloudRunSpoke",
      message: "Process exited with no error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      execResponse
    });

    res.status(200).send({
      message: "Process exited with no error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      execResponse
    });
  } catch (execResponse) {
    // If there is an error, send a debug log to the winston transport to capture in GCP. We dont want to trigger a
    // `logger.error` here as this will be dealt with one layer up in the Hub implementation.
    logger.debug({
      at: "CloudRunSpoke",
      message: "Process exited with error 🚨",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      jsonBody: req.body,
      execResponse: execResponse instanceof Error ? execResponse.message : execResponse
    });

    res.status(500).send({
      message: "Process exited with error",
      childProcessIdentifier: _getChildProcessIdentifier(req),
      execResponse: execResponse instanceof Error ? execResponse.message : execResponse
    });
  }
});

function _execShellCommand(cmd, inputEnv) {
  return new Promise(resolve => {
    exec(cmd, { env: { ...process.env, ...inputEnv, stdio: "inherit", shell: true } }, (error, stdout, stderr) => {
      // The output from the process execution contains a punctuation marks and escape chars that should be stripped.
      stdout = _stripExecStdout(stdout);
      stderr = _stripExecStdError(stderr);
      resolve({ error, stdout, stderr });
    });
  });
}

// Format stdout outputs. Turns all logs generated while running the script into an array of Json objects.
function _stripExecStdout(output) {
  if (!output) return output;
  // Parse the outputs into a json object to get an array of logs. It is possible that the output is not in a parable form
  // if the spoke was running a process that did not correctly generate a winston log. In this case simply return the stripped output.
  try {
    const strippedOutput = _regexStrip(output).replace(/\r?\n|\r/g, ","); // Remove escaped new line chars. Replace with comma between each log output.
    return JSON.parse("[" + strippedOutput.substring(0, strippedOutput.length - 1) + "]");
  } catch (error) {
    return _regexStrip(output).replace(/\r?\n|\r/g, " ");
  }
}

// Format stderr outputs.
function _stripExecStdError(output) {
  if (!output) return output;
  return _regexStrip(output)
    .replace(/\r?\n|\r/g, "")
    .replace(/\"/g, ""); // Remove escaped new line chars. Replace with no space.
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
async function Poll(injectedLogger = Logger, port = 8080) {
  logger = injectedLogger;
  return spoke.listen(port, () => {
    logger.debug({
      at: "CloudRunSpoke",
      message: "Cloud Run spoke initialized",
      port
    });
  });
}
// If called directly by node, start the Poll process. If imported as a module then do nothing.
if (require.main === module) {
  Poll(Logger, process.env.PORT).then(() => {}); // Use the default winston logger & env port.
}

spoke.Poll = Poll;
module.exports = spoke;
