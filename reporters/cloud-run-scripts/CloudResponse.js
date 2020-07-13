/**
 * @notice This script enables Google Cloud Run functions to execute any arbitrary command from the UMA docker container.
 * Cloud Run provides a privileged REST endpoint that can be called to spin up a Docker container. This endpoint is
 * expected to respond on PORT. Upon receiving a request, this script executes a child process and responds to the
 * REST query with the output of the process execution. The REST query sent to the API is expected to be a POST
 * with a body formatted as: {"cloudRunCommand":<some-command-to-run>, environmentVariables: <env-variable-object>}
 * the some-command-to-run is any execution process. For example to run the monitor bot this could be set to:
 * { "cloudRunCommand":"npx truffle exec ../monitors/index.js --network mainnet_mnemonic" }. `environmentVariables` is
 * optional. If included the child process will have additional parameters appended with these params.
 */

const express = require("express");
const app = express();
app.use(express.json()); // Enables json to be parsed by the express process.
const exec = require("child_process").exec;

const { Logger, waitForLogger } = require("../../financial-templates-lib/logger/Logger");

app.post("/", async (req, res) => {
  try {
    Logger.debug({
      at: "CloudRunnerResponse",
      message: "Executing GCP Cloud Run API Call",
      reqBody: req.body,
      childProcessIdentifier: req.body.environmentVariables.BOT_IDENTIFIER
    });
    if (!req.body.cloudRunCommand) {
      throw "ERROR: Missing cloudRunCommand";
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
    Logger.debug({
      at: "CloudRunnerResponse",
      message: "Process exited with no error",
      execResponse,
      childProcessIdentifier: req.body.environmentVariables.BOT_IDENTIFIER
    });

    res.status(200).send({ message: "Process exited with no error", execResponse });
  } catch (execResponse) {
    // If there is an error, send a debug log. We dont want to trigger a `Logger.error` here as this will be dealt with
    // one layer up in the Hub implementation.
    Logger.debug({
      at: "CloudRunnerResponse",
      message: "Process exited with error",
      execResponse,
      jsonBody: req.body,
      childProcessIdentifier: req.body.environmentVariables.BOT_IDENTIFIER
    });
    res.status(400).send({ message: "Process exited with error", execResponse });
  }
});

function _execShellCommand(cmd, inputEnv) {
  return new Promise((resolve, reject) => {
    exec(cmd, { env: { ...process.env, ...inputEnv } }, (error, stdout, stderr) => {
      // The output from the process execution contains a punctuation marks and escape chars that should be stripped.
      // This Regex removes these and formats the output in a digestible fashion.
      stdout = _stripExecOutput(stdout);
      stderr = _stripExecOutput(stderr);
      resolve({ error, stdout, stderr });
    });
  });
}

function _stripExecOutput(output) {
  if (!output) return output;
  return output
    .replace(/\r?\n|\r/g, "") // Remove escaped new line chars
    .replace(/\s\s+/g, " ") // Remove move tabbed chars
    .replace(/\"/g, ""); // Remove escaped quotes
}
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log("Listening on port", port);
});
