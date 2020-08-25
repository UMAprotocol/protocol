/**
 * @notice This script reads in a global configuration file stored on GCP buckets and executes parallel Cloud Run
 * instances for each configured bot. This enables one global config file to define all bot instances. This drastically
 * simplifying the devops and management overhead for spinning up new instances as this can be done by simply updating
 * a config file. This script is designed to be run within a GCP Cloud Run (or cloud function) environment with a
 * permissioned service account to pull config objects from GCP buckets and execute Cloud Run functions.
 * This script assumes the caller is providing a HTTP POST with a body formatted as:
 * {"bucket":"<config-bucket>","configFile":"<config-file-name>"}
 *
 * If you want to run it in your local environment, you need to do the following configuration changes:
 * 1) Set the environment variable PROTOCOL_RUNNER_URL to point to your remote cloud run instance URL.
 * 2) To access service accounts you need to configure your local environment with the associated config file. Go to:
 * https://console.cloud.google.com/apis/credentials/serviceaccountkey and generate a json config file. Save this to
 * a safe place. Then, set the environment variable GOOGLE_APPLICATION_CREDENTIALS to point to this config file.
 * 3) Once this is done the script can be started by running: node ../reporters/cloud-run-scripts/CloudRunnerHub.js
 * This will start a restful API server on PORT (default 8080).
 * 4) call the restful query using CURL as:
 * curl -X POST -H 'Content-type: application/json' --data '{"bucket":"bot-configs","configFile":"global-bot-config.json"}' https://localhost:8080
 */

// TODO: add integration tests between this CloudRunnerHub and CloudResponse.

const express = require("express");
const app = express();
app.use(express.json()); // Enables json to be parsed by the express process.
require("dotenv").config();
const fetch = require("node-fetch");
const { URL } = require("url");

// GCP helpers.
const { GoogleAuth } = require("google-auth-library"); // Used to get authentication headers to execute cloud run.
const auth = new GoogleAuth();
const { Storage } = require("@google-cloud/storage"); // Used to get global config objects to parameterize bots.
const storage = new Storage();
const { Datastore } = require("@google-cloud/datastore"); // Used to read/write the last block number the monitor used.
const datastore = new Datastore();

// Web3 instance to get current block numbers of polling loops.
const Web3 = require("web3");

const { Logger } = require("@umaprotocol/financial-templates-lib");

app.post("/", async (req, res) => {
  try {
    Logger.debug({
      at: "CloudRunnerHub",
      message: "Running cloud runner hub query",
      reqBody: req.body
    });
    // Validate the post request has both the `bucket` and `configFile` params.
    if (!req.body.bucket || !req.body.configFile) {
      throw new Error("ERROR: Body missing json bucket or file parameters!");
    }

    // Get the config file from the GCP bucket if running in production mode. Else, pull the config from env.
    const configObject = await _fetchConfigObject(req.body.bucket, req.body.configFile);

    // Fetch the last block number this given config file queried the blockchain at if running in production. Else, pull from env.
    const lastQueriedBlockNumber = await _getLastQueriedBlockNumber(req.body.configFile);

    // Get the latest block number. The query will run from the last queried block number to the latest block number.
    const latestBlockNumber = await _getLatestBlockNumber();

    // Save the current latest block number to the remote cache. This will be the used as the "lastQueriedBlockNumber"
    // in the next iteration when the hub is called again.
    await _saveQueriedBlockNumber(req.body.configFile, latestBlockNumber);

    // Loop over all config objects in the config file and for each append a call promise to the promiseArray.
    let promiseArray = [];
    for (const botName in configObject) {
      const botConfig = _appendBlockNumberEnvVars(configObject[botName], lastQueriedBlockNumber, latestBlockNumber);
      if (process.env.ENVIRONMENT == "production") {
        promiseArray.push(_executeCloudRun(process.env.PROTOCOL_RUNNER_URL, botConfig));
      } else {
        promiseArray.push(_postJson(process.env.PROTOCOL_RUNNER_URL, botConfig));
      }
    }
    Logger.debug({
      at: "CloudRunnerHub",
      message: "Executing cloud run query from config file",
      lastQueriedBlockNumber,
      latestBlockNumber,
      botsExecuted: Object.keys(configObject)
    });

    // Loop through promise array and submit all in parallel. `allSettled` does not fail early if a promise is rejected.
    // This `results` object will contain all information sent back from the spokes. This contains the process exit code,
    // and importantly the full execution output which can be used in debugging.
    const results = await Promise.allSettled(promiseArray);

    Logger.debug({
      at: "CloudRunnerHub",
      message: "Batch execution promise resolved",
      results
    });

    // Validate that the promises returned correctly. If ANY have error, then catch them and throw them all together.
    let thrownErrors = [];
    results.forEach((result, index) => {
      if (result.status == "rejected") {
        // If the child process in the spoke crashed it will return 400 (rejected).
        thrownErrors.push({
          status: result.status,
          execResponse: result.reason.response.data,
          botIdentifier: Object.keys(configObject)[index]
        });
      } else if (result.value.execResponse.error) {
        // If the child process exited correctly but contained an error.
        thrownErrors.push({
          status: result.status,
          execResponse: result.value.execResponse,
          botIdentifier: Object.keys(configObject)[index]
        });
      }
    });
    if (thrownErrors.length > 0) {
      throw thrownErrors;
    }

    // If no errors and got to this point correctly then return a 200 success status.
    Logger.debug({
      at: "CloudRunnerHub",
      message: "All calls returned correctly",
      thrownErrors: null
    });
    res.status(200).send({ message: "All calls returned correctly", error: null });
  } catch (thrownErrors) {
    Logger.error({
      at: "CloudRunnerHub",
      message: "CloudRunner hub error 🌩 ",
      thrownErrors
    });
    res.status(400).send({ message: "Something went wrong in cloud runner hub execution", thrownErrors });
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

  return res.data;
};

// Save a the last blocknumber seen by the hub to GCP datastore. `BlockNumberLog` is the entry kind and
// `lastHubUpdateBlockNumber` is the entry ID. Will override the previous value on each run.
async function _saveQueriedBlockNumber(configIdentifier, blockNumber) {
  const key = datastore.key(["BlockNumberLog", configIdentifier]);
  const dataBlob = {
    key: key,
    data: {
      blockNumber
    }
  };

  // Saves the entity
  await datastore.save(dataBlob);
}

// Query entry kind `BlockNumberLog` with unique entry ID of `configIdentifier`. Used to get the last block number
// recorded by the bot to inform where searches should start from.
async function _getLastQueriedBlockNumber(configIdentifier) {
  const key = datastore.key(["BlockNumberLog", configIdentifier]);
  const [dataField] = await datastore.get(key);

  // If the data field is undefined then this is the first time the hub is run. Therefore return the latest block number.
  if (dataField == undefined) return await _getLatestBlockNumber();
  return dataField.blockNumber;
}

// Get the latest block number from `CUSTOM_NODE_URL`. Used to update the `lastSeenBlockNumber` after each run.
async function _getLatestBlockNumber() {
  const web3 = new Web3(process.env.CUSTOM_NODE_URL);
  return await web3.eth.getBlockNumber();
}

// Add additional environment variables for a given config file. Used to attach starting and ending block numbers.
function _appendBlockNumberEnvVars(config, lastQueriedBlockNumber, latestBlockNumber) {
  // The starting block number should be one block after the last queried block number to not double report that block.
  config.environmentVariables["STARTING_BLOCK_NUMBER"] = lastQueriedBlockNumber + 1;
  config.environmentVariables["ENDING_BLOCK_NUMBER"] = latestBlockNumber;
  return config;
}

// Execute a post query on a arbitrary `url` with a given json `body. Used to test the hub script locally.
async function _postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-type": "application/json",
      Accept: "application/json",
      "Accept-Charset": "utf-8"
    }
  });
  return await response.json(); // extract JSON from the http response
}

const port = process.env.PORT || 8080;
app.listen(port, () => {
  Logger.debug({
    at: "CloudRunnerHub",
    message: "Initalized Cloud Runner hub instance",
    processEnvironment: process.env,
    port
  });
  // The cloud runner hub should have a configured URL to define the remote instance & a local node URL to boot.
  if (!process.env.PROTOCOL_RUNNER_URL || !process.env.CUSTOM_NODE_URL) {
    throw new Error(
      "Bad environment! Specify a `PROTOCOL_RUNNER_URL` & `CUSTOM_NODE_URL` to point to the a cloud run instance and Ethereum node"
    );
  }
});
