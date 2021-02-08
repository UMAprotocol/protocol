/**
 * @notice This script reads in a global configuration file stored and executes  parallel serverless instances for each
 * configured bot. This enables one global config file to define all bot instances. This drastically simplifying the
 * devops and management overhead for spinning up new instances as this can be done by simply updating a single config
 * file. This script is designed to be run within a number of different environments:
 * 1)  GCP Cloud Run (or cloud function) environment with a permissioned service account. This enables infinite scalability
 * to run thousands of parallel bot processes.
 * 2) Local machine to enable simple orchestration between a number of bot processes all running on one main process.
 * Configurations for the bots are pulled from from either a) localStorage, b) github or c) GCP storage bucket.
 * The main configurations for the serverless hub are:
 * 1) PORT: local port to run the hub on. if not specified will default to 8080
 * 2) SPOKE_URL: http url to a serverless spoke instance. This could be local host (if running locally) or a GCP
 * cloud run/cloud function URL which will spin up new instances for each parallel bot execution.
 * 3) CUSTOM_NODE_URL: an ethereum node used to fetch the latest block number when the script runs.
 4 ) HUB_CONFIG: JSON object configuring configRetrieval to define where to pull configs from, saveQueriedBlock to 
 * define where to save last queried block numbers and spokeRunner to define the execution environment for the spoke process. 
 * This script assumes the caller is providing a HTTP POST with a body formatted as:
 * {"bucket":"<config-bucket>","configFile":"<config-file-name>"}
 */
const retry = require("async-retry");
const express = require("express");
const hub = express();
hub.use(express.json()); // Enables json to be parsed by the express process.
require("dotenv").config();
const fetch = require("node-fetch");
const { URL } = require("url");

// GCP helpers.
const { GoogleAuth } = require("google-auth-library"); // Used to get authentication headers to execute cloud run & cloud functions.
const auth = new GoogleAuth();
const { Storage } = require("@google-cloud/storage"); // Used to get global config objects to parameterize bots.
const storage = new Storage();
const { Datastore } = require("@google-cloud/datastore"); // Used to read/write the last block number the monitor used.
const datastore = new Datastore();

// Web3 instance to get current block numbers of polling loops.
const Web3 = require("web3");

const { Logger, delay } = require("@uma/financial-templates-lib");
let logger;
let spokeUrl;
let customNodeUrl;
let hubConfig = {};

const defaultHubConfig = {
  configRetrieval: "localStorage",
  saveQueriedBlock: "localStorage",
  spokeRunner: "localStorage",
  rejectSpokeDelay: 120 // 2 min.
};

hub.post("/", async (req, res) => {
  try {
    logger.debug({
      at: "ServerlessHub",
      message: "Running Serverless hub query",
      reqBody: req.body,
      hubConfig
    });

    // Validate the post request has both the `bucket` and `configFile` params.
    if (!req.body.bucket || !req.body.configFile) {
      throw new Error("Body missing json bucket or file parameters!");
    }
    // Get the config file from the GCP bucket if running in production mode. Else, pull the config from env.
    const configObject = await _fetchConfig(req.body.bucket, req.body.configFile);

    // Fetch the last block number this given config file queried the blockchain at if running in production. Else, pull from env.
    const lastQueriedBlockNumber = await _getLastQueriedBlockNumber(req.body.configFile);
    if (!configObject || !lastQueriedBlockNumber)
      throw new Error(
        `Serverless hub requires a config object and a last updated block number! configObject:${JSON.stringify(
          configObject
        )} lastQueriedBlockNumber:${lastQueriedBlockNumber}`
      );

    // Get the latest block number. The query will run from the last queried block number to the latest block number.
    const latestBlockNumber = await _getLatestBlockNumber();

    // Save the current latest block number to the remote cache. This will be the used as the "lastQueriedBlockNumber"
    // in the next iteration when the hub is called again.
    await _saveQueriedBlockNumber(req.body.configFile, latestBlockNumber);

    // Loop over all config objects in the config file and for each append a call promise to the promiseArray. Note
    // that each promise is a race between the serverlessSpoke command and a `_rejectAfterDelay`. This places an upper
    // bound on how long each spoke can take to respond, acting as a timeout for each spoke call.
    let promiseArray = [];
    let botConfigs = {};
    for (const botName in configObject) {
      const botConfig = _appendEnvVars(configObject[botName], botName, lastQueriedBlockNumber, latestBlockNumber);
      botConfigs[botName] = botConfig;
      promiseArray.push(
        Promise.race([
          _executeServerlessSpoke(spokeUrl, botConfig),
          _rejectAfterDelay(hubConfig.rejectSpokeDelay, botName)
        ])
      );
    }
    logger.debug({
      at: "ServerlessHub",
      message: "Executing Serverless query from config file",
      lastQueriedBlockNumber,
      latestBlockNumber,
      spokeUrl,
      botsExecuted: Object.keys(configObject)
    });

    // Loop through promise array and submit all in parallel. `allSettled` does not fail early if a promise is rejected.
    // This `results` object will contain all information sent back from the spokes. This contains the process exit code,
    // and importantly the full execution output which can be used in debugging.
    const results = await Promise.allSettled(promiseArray);

    // Validate that the promises returned correctly. If any spokes rejected it is possible that it was due to a networking
    // or internal GCP error. Re-try these executions. If a response is code 500 or contains an error then log it as an error.
    let errorOutputs = {};
    let validOutputs = {};
    let retriedOutputs = [];
    results.forEach((result, index) => {
      if (result.status == "rejected") {
        // If it is rejected, then store the name so we can try re-run the spoke call.
        retriedOutputs.push(Object.keys(configObject)[index]); // Add to retriedOutputs to re-run the call.
        return; // go to next result in the forEach loop.
      }
      // Process the spoke response. This extracts useful log information and discern if the spoke had generated an error.
      _processSpokeResponse(Object.keys(configObject)[index], result, validOutputs, errorOutputs);
    });
    // Re-try the rejected outputs in a separate promise.all array.
    if (retriedOutputs.length > 0) {
      logger.debug({
        at: "ServerlessHub",
        message: "One or more spoke calls were rejected - Retrying",
        retriedOutputs
      });
      let rejectedRetryPromiseArray = [];
      retriedOutputs.forEach(botName => {
        rejectedRetryPromiseArray.push(
          Promise.race([
            _executeServerlessSpoke(spokeUrl, botConfigs[botName]),
            _rejectAfterDelay(hubConfig.rejectSpokeDelay, botName)
          ])
        );
      });
      const rejectedRetryResults = await Promise.allSettled(rejectedRetryPromiseArray);
      rejectedRetryResults.forEach((result, index) => {
        _processSpokeResponse(retriedOutputs[index], result, validOutputs, errorOutputs);
      });
    }
    // If there are any error outputs(from the original loop or from re-tried calls) then throw.
    if (Object.keys(errorOutputs).length > 0) {
      throw { errorOutputs, validOutputs, retriedOutputs };
    }

    // If no errors and got to this point correctly then return a 200 success status.
    logger.debug({
      at: "ServerlessHub",
      message: "All calls returned correctly",
      output: { errorOutputs, validOutputs, retriedOutputs }
    });
    await delay(2); // Wait a few seconds to be sure the the winston logs are processed upstream.
    res
      .status(200)
      .send({ message: "All calls returned correctly", output: { errorOutputs, validOutputs, retriedOutputs } });
  } catch (errorOutput) {
    // If the errorOutput is an instance of Error then we know that error was produced within the hub. Else, it is from
    // one of the upstream spoke calls. Depending on the kind of error, process the logs differently.
    if (errorOutput instanceof Error) {
      logger.error({
        at: "ServerlessHub",
        message: "A fatal error occurred in the hub",
        output: errorOutput.message
      });
    } else {
      // Else, the error was produced within one of the spokes. If this is the case then we need to process the errors a bit.
      logger.debug({
        at: "ServerlessHub",
        message: "Some spoke calls returned errors (details)🚨",
        output: errorOutput
      });
      logger.error({
        at: "ServerlessHub",
        message: "Some spoke calls returned errors 🚨",
        retriedSpokes: errorOutput.retriedOutputs,
        errorOutputs: Object.keys(errorOutput.errorOutputs).map(spokeName => {
          try {
            return {
              spokeName: spokeName,
              errorReported: errorOutput.errorOutputs[spokeName].execResponse
                ? errorOutput.errorOutputs[spokeName].execResponse.stderr
                : errorOutput.errorOutputs[spokeName]
            };
          } catch (err) {
            // `errorMessages` is in an unexpected JSON shape.
            return "Hub unable to parse error";
          }
        }), // eslint-disable-line indent
        validOutputs: Object.keys(errorOutput.validOutputs) // eslint-disable-line indent
      });
    }
    await delay(2); // Wait a few seconds to be sure the the winston logs are processed upstream.
    res.status(500).send({
      message: errorOutput instanceof Error ? "A fatal error occurred in the hub" : "Some spoke calls returned errors",
      output: errorOutput instanceof Error ? errorOutput.message : errorOutput
    });
  }
});

// Execute a serverless POST command on a given `url` with a provided json `body`. This is used to initiate the spoke
// instance from the hub. If running in gcp mode then local service account must be permissioned to execute this command.
const _executeServerlessSpoke = async (url, body) => {
  if (hubConfig.spokeRunner == "gcp") {
    const targetAudience = new URL(url).origin;

    const client = await auth.getIdTokenClient(targetAudience);
    const res = await client.request({
      url: url,
      method: "post",
      data: body
    });

    return res.data;
  } else if (hubConfig.spokeRunner == "localStorage") {
    return _postJson(url, body);
  }
};

// Fetch configs for serverless hub. Either read from a gcp bucket, local storage or a git repo. Github configs can pull
// from a private github repo using the provided Authorization token. GCP uses a readStream which is converted into a
// buffer such that the config file does not need to first be downloaded from the bucket. This will use the local service
// account. Local configs are read directly from the process's environment variables.
const _fetchConfig = async (bucket, file) => {
  if (hubConfig.configRetrieval == "git") {
    const response = await fetch(
      `https://api.github.com/repos/${hubConfig.gitSettings.organization}/${hubConfig.gitSettings.repoName}/contents/${bucket}/${file}`,
      {
        method: "GET",
        headers: {
          Authorization: `token ${hubConfig.gitSettings.accessToken}`,
          "Content-type": "application/json",
          Accept: "application/vnd.github.v3.raw",
          "Accept-Charset": "utf-8"
        }
      }
    );
    const config = await response.json(); // extract JSON from the http response
    // If there is a message in the config response then something went wrong in fetching from github api.
    if (config.message) throw new Error(`Could not fetch config! :${JSON.stringify(config)}`);
    return config;
  }
  if (hubConfig.configRetrieval == "gcp") {
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
  } else if (hubConfig.configRetrieval == "localStorage") {
    const config = process.env[`${bucket}-${file}`];
    if (!config) {
      throw new Error(`No local storage config found for ${bucket}-${file}`);
    }
    return JSON.parse(config);
  }
};

// Save a the last blocknumber seen by the hub to GCP datastore. `BlockNumberLog` is the entry kind and
// `lastHubUpdateBlockNumber` is the entry ID. Will override the previous value on each run.
async function _saveQueriedBlockNumber(configIdentifier, blockNumber) {
  // Sometimes the GCP datastore can be flaky and return errors when fetching data. Use re-try logic to re-run on error.
  await retry(
    async () => {
      if (hubConfig.saveQueriedBlock == "gcp") {
        const key = datastore.key(["BlockNumberLog", configIdentifier]);
        const dataBlob = {
          key: key,
          data: {
            blockNumber
          }
        };
        await datastore.save(dataBlob); // Saves the entity
      } else if (hubConfig.saveQueriedBlock == "localStorage") {
        process.env[`lastQueriedBlockNumber-${configIdentifier}`] = blockNumber;
      }
    },
    {
      retries: 2,
      minTimeout: 2000, // delay between retries in ms
      onRetry: error => {
        logger.debug({
          at: "serverlessHub",
          message: "An error was thrown when saving the previously queried block number - retrying",
          error: typeof error === "string" ? new Error(error) : error
        });
      }
    }
  );
}

// Query entry kind `BlockNumberLog` with unique entry ID of `configIdentifier`. Used to get the last block number
// recorded by the bot to inform where searches should start from.
async function _getLastQueriedBlockNumber(configIdentifier) {
  // sometimes the GCP datastore can be flaky and return errors when saving data. Use re-try logic to re-run on error.
  return await retry(
    async () => {
      if (hubConfig.saveQueriedBlock == "gcp") {
        const key = datastore.key(["BlockNumberLog", configIdentifier]);
        const [dataField] = await datastore.get(key);
        // If the data field is undefined then this is the first time the hub is run. Therefore return the latest block number.
        if (dataField == undefined) return await _getLatestBlockNumber();
        return dataField.blockNumber;
      } else if (hubConfig.saveQueriedBlock == "localStorage") {
        return process.env[`lastQueriedBlockNumber-${configIdentifier}`] != undefined
          ? process.env[`lastQueriedBlockNumber-${configIdentifier}`]
          : await _getLatestBlockNumber();
      }
    },
    {
      retries: 2,
      minTimeout: 2000, // delay between retries in ms
      onRetry: error => {
        logger.debug({
          at: "serverlessHub",
          message: "An error was thrown when fetching the most recent block number - retrying",
          error: typeof error === "string" ? new Error(error) : error
        });
      }
    }
  );
}

// Get the latest block number from `CUSTOM_NODE_URL`. Used to update the `lastSeenBlockNumber` after each run.
async function _getLatestBlockNumber() {
  const web3 = new Web3(customNodeUrl);
  return await web3.eth.getBlockNumber();
}

// Add additional environment variables for a given config file. Used to attach starting and ending block numbers.
function _appendEnvVars(config, botName, lastQueriedBlockNumber, latestBlockNumber) {
  // The starting block number should be one block after the last queried block number to not double report that block.
  config.environmentVariables["STARTING_BLOCK_NUMBER"] = Number(lastQueriedBlockNumber) + 1;
  config.environmentVariables["ENDING_BLOCK_NUMBER"] = latestBlockNumber;
  config.environmentVariables["BOT_IDENTIFIER"] = botName;
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

// Takes in a spokeResponse object for a given botKey and identifies if the response includes an error. If it does,
// append the error information to the errorOutputs. If there is no error, append to validOutputs.
function _processSpokeResponse(botKey, spokeResponse, validOutputs, errorOutputs) {
  if (spokeResponse.status == "rejected" && spokeResponse.reason.status == "timeout") {
    errorOutputs[botKey] = {
      status: "timeout",
      message: spokeResponse.reason.message,
      botIdentifier: botKey
    };
  } else if (
    spokeResponse.status == "rejected" ||
    (spokeResponse.value && spokeResponse.value.execResponse && spokeResponse.value.execResponse.error) ||
    (spokeResponse.reason && spokeResponse.reason.code == "500")
  ) {
    errorOutputs[botKey] = {
      status: spokeResponse.status,
      execResponse:
        (spokeResponse.value && spokeResponse.value.execResponse) ||
        (spokeResponse.reason &&
          spokeResponse.reason.response &&
          spokeResponse.reason.response.data &&
          spokeResponse.reason.response.data.execResponse),
      botIdentifier: botKey
    };
  } else {
    validOutputs[botKey] = {
      status: spokeResponse.status,
      execResponse: spokeResponse.value && spokeResponse.value.execResponse,
      botIdentifier: botKey
    };
  }
}

// Returns a promise that is rejected after seconds delay. Used to limit how long a spoke can run for.
const _rejectAfterDelay = (seconds, childProcessIdentifier) =>
  new Promise((_, reject) => {
    setTimeout(reject, seconds * 1000, {
      status: "timeout",
      message: `The spoke call took longer than ${seconds} seconds to reply`,
      childProcessIdentifier
    });
  });

// Start the hub's async listening process. Enables injection of a logging instance & port for testing.
async function Poll(_Logger = Logger, port = 8080, _spokeURL, _CustomNodeUrl, _hubConfig) {
  // The Serverless hub should have a configured URL to define the remote instance & a local node URL to boot.
  if (!_spokeURL || !_CustomNodeUrl) {
    throw new Error(
      "Bad environment! Specify a `SPOKE_URL` & `CUSTOM_NODE_URL` to point to the a Serverless spoke instance and an Ethereum node"
    );
  }

  // Set configs to be used in the sererless execution.
  logger = _Logger;
  spokeUrl = _spokeURL;
  customNodeUrl = _CustomNodeUrl;
  if (_hubConfig) hubConfig = { ...defaultHubConfig, ..._hubConfig };
  else hubConfig = defaultHubConfig;

  return hub.listen(port, () => {
    logger.debug({
      at: "ServerlessHub",
      message: "Serverless hub initialized",
      spokeUrl,
      customNodeUrl,
      hubConfig,
      port,
      processEnvironment: process.env
    });
  });
}
// If called directly by node, start the Poll process. If imported as a module then do nothing.
if (require.main === module) {
  // add the logger, port, protocol runnerURL and custom node URL as params.
  hubConfig;
  try {
    hubConfig = process.env.HUB_CONFIG ? JSON.parse(process.env.HUB_CONFIG) : null;
  } catch (error) {
    console.error("Malformed hub config!", hubConfig);
    process.exit(1);
  }

  Poll(Logger, process.env.PORT, process.env.SPOKE_URL, process.env.CUSTOM_NODE_URL, hubConfig).then(() => {});
}

hub.Poll = Poll;
module.exports = hub;
