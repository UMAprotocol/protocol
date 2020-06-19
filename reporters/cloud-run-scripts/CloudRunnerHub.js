const express = require("express");
const app = express();
app.use(express.json()); // Enables json to be parsed by the express process.
require("dotenv").config();
const fetch = require("node-fetch");
const { URL } = require("url");

// GCP helpers
const { GoogleAuth } = require("google-auth-library");
const auth = new GoogleAuth();
const { Storage } = require("@google-cloud/storage");
const storage = new Storage();

// Helpers
// const { Logger, waitForLogger } = require("../../financial-templates-lib/logger/Logger");

app.post("/", async (req, res) => {
  try {
    console.log("Running Cloud runner hub");
    if (!process.env.PROTOCOL_RUNNER_URL) {
      throw new Error("Bad environment! Specify a `PROTOCOL_RUNNER_URL` to point to the a cloud run instance");
    }

    if (!req.body.bucket || !req.body.file) {
      res.status(400).send({
        message: "ERROR: Body missing json bucket or file parameters!"
      });
      throw new Error("ERROR: Body missing json bucket or file parameters!");
    }

    const protocolRunnerUrl = process.env.PROTOCOL_RUNNER_URL;

    const configObject = await _fetchConfigObject(req.body.bucket, req.body.file);
    console.log("configObject", configObject);

    for (const botName in configObject) {
      const botConfig = configObject[botName];
      console.log("executing bot", botName);
      await _executeCloudRun(protocolRunnerUrl, botConfig);
    }

    res.status(200).send("Done");
  } catch (error) {
    console.log("error", error);
    res.status(400).send("error", error);
  }
});

// Fetch a `file` from a GCP `bucket`. This function uses a readStream which is converted into a buffer such that the
// config file does not need to first be downloaded from the bucket. This will use the local service account.
const _fetchConfigObject = async (bucket, file) => {
  const requestPromise = new Promise((resolve, reject) => {
    let buf = "";
    storage
      .bucket(bucket)
      .file(file)
      .createReadStream()
      .on("data", d => (buf += d))
      .on("end", () => resolve(buf))
      .on("error", e => reject(e));
  });

  return JSON.parse(await requestPromise);
};

// Execute a Cloud Run Post command on a given `url` with a provided json `body`. The local service account must
// be permissioned to execute this command.
const _executeCloudRun = async (url, body) => {
  const targetAudience = new URL(url).origin;

  const client = await auth.getIdTokenClient(targetAudience);
  const res = await client.request({
    url: url,
    method: "post",
    data: body
  });
  console.info(res.data);
};

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log("Listening on port", port);
});
