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

app.post("/", async (req, res) => {
  try {
    console.log("Executing GCP Cloud Run API Call");
    if (!req.body.cloudRunCommand) {
      res.status(400).send({
        message: "ERROR: Body missing json cloudRunCommand!"
      });
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

    const execResponse = await execShellCommand(req.body.cloudRunCommand, processedEnvironmentVariables);
    // TODO: refactor this to send a more graceful winston log.
    console.log("execResponse:", execResponse);

    if (execResponse.error) {
      console.log("Process exited with error");
      throw execResponse;
    }
    console.log("Process exited with no error");

    res.status(200).send({ message: "Process exited correctly!", execResponse: execResponse });
  } catch (execResponse) {
    res.status(400).send({ message: "Process exited with error!", execResponse: execResponse });
  }
});

function execShellCommand(cmd, inputEnv) {
  return new Promise((resolve, reject) => {
    exec(cmd, { env: { ...process.env, ...inputEnv } }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}
const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log("Listening on port", port);
});
