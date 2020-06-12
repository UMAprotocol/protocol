const express = require("express");
const app = express();
app.use(express.json()); // Enables json to be parsed by the express process.
const { exec } = require("child_process");

app.post("/", (req, res) => {
  console.log("Executing GCP Cloud Run API");
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

  // Run the command from the request body. Note this assumes that the process is running from the /core directory.
  // Include the environment variables. Having both ...process.env and ...processedEnvironmentVariables acts to combined
  // the existing env variables with those passed in from the req.
  exec(
    req.body.cloudRunCommand,
    { env: { ...process.env, ...processedEnvironmentVariables } },
    (error, stdout, stderr) => {
      if (error !== null) {
        console.error(`exec error: ${error}stderr: ${stderr}`);
        res.status(400).send({
          message: "ERROR executing process!",
          stdout,
          stderr,
          error
        });
      } else {
        console.error(`stdout: ${stdout}`);
        res.status(200).send({ message: "Process executed correctly!", stdout, stderr, error: null });
      }
    }
  );
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log("Listening on port", port);
});
