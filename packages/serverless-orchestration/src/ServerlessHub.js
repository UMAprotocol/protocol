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
const lodash = require("lodash");

// GCP helpers.
const { GoogleAuth } = require("google-auth-library"); // Used to get authentication headers to execute cloud run & cloud functions.
const auth = new GoogleAuth();
const { Storage } = require("@google-cloud/storage"); // Used to get global config objects to parameterize bots.
const storage = new Storage();
const { Datastore } = require("@google-cloud/datastore"); // Used to read/write the last block number the monitor used.
const datastore = new Datastore();
const { createBasicProvider } = require("@uma/common");

// Web3 instance to get current block numbers of polling loops.
const Web3 = require("web3");

const { delay, createNewLogger } = require("@uma/financial-templates-lib");
let customLogger;
let spokeUrl;
let customNodeUrl;
let hubConfig = {};

const defaultHubConfig = {
  configRetrieval: "localStorage",
  saveQueriedBlock: "localStorage",
  spokeRunner: "localStorage",
  rejectSpokeDelay: 120, // 2 min.
};

const waitForLoggerDelay = process.env.WAIT_FOR_LOGGER_DELAY || 5;

hub.post("/", async (req, res) => {
  // Use a custom logger if provided. Otherwise, initialize a local logger.
  // Note: no reason to put this into the try-catch since a logger is required to throw the error.
  const logger = customLogger || createNewLogger();
  try {
    logger.debug({ at: "ServerlessHub", message: "Running Serverless hub query", reqBody: req.body, hubConfig });

    // Validate the post request has both the `bucket` and `configFile` params.
    if (!req.body.bucket || !req.body.configFile) {
      throw new Error("Body missing json bucket or file parameters!");
    }

    // Allow the request to override the spoke rejection timeout.
    const spokeRejectionTimeout =
      req.body.rejectSpokeDelay !== undefined ? parseInt(req.body.rejectSpokeDelay) : hubConfig.rejectSpokeDelay;

    // Get the config file from the GCP bucket if running in production mode. Else, pull the config from env.
    const configObject = await _fetchConfig(req.body.bucket, req.body.configFile);
    if (!configObject)
      throw new Error(
        `Serverless hub missing a config object! GCPBucket:${req.body.bucket} configFile:${req.body.configFile}`
      );
    logger.debug({
      at: "ServerlessHub",
      message: "Executing Serverless query from config file",
      spokeUrl,
      botsExecuted: Object.keys(configObject),
      configObject: hubConfig.printHubConfig ? configObject : "REDACTED",
    });

    // As a first pass, loop over all config objects in the config file and fetch the last queried block number and
    // head block for each unique chain ID. The reason why we precompute these block numbers for each chain ID is so
    // that each bot connected to the same chain will use the same block number parameters, which is a convenient
    // assumption if there are many bots running on the same chain.
    let blockNumbersForChain = {
      // (chainId: int): {
      //     lastQueriedBlockNumber: <int>
      //     latestBlockNumber: <int>
      // }
    };
    let nodeUrlToChainIdCache = {
      // (url: string): <int>
    };
    for (const botName in configObject) {
      // Check if bot is running on a non-default chain, and fetch last block number seen on this or the default chain.
      const [botWeb3, spokeCustomNodeUrl] = _getWeb3AndUrlForBot(configObject[botName]);
      const chainId = await _getChainId(botWeb3);
      // If we've seen this chain ID already we can skip it.
      if (blockNumbersForChain[chainId]) continue;

      nodeUrlToChainIdCache[spokeCustomNodeUrl] = chainId;

      // If STORE_MULTI_CHAIN_BLOCK_NUMBERS is set then this bot requires to know a number of last seen blocks across
      // a set of chainIds. Construct a batch promise to evaluate the latest block number for each chainId.
      if (configObject[botName]?.environmentVariables?.STORE_MULTI_CHAIN_BLOCK_NUMBERS) {
        const multiChainIds = configObject[botName]?.environmentVariables?.STORE_MULTI_CHAIN_BLOCK_NUMBERS;
        let promises = [];
        for (const chainId of multiChainIds) {
          promises.push(
            _getLastQueriedBlockNumber(req.body.configFile, chainId, logger),
            _getBlockNumberOnChainIdMultiChain(configObject[botName], chainId)
          );
        }
        let results = await Promise.all(promises);
        results.forEach((_, index) => {
          if (index % 2 !== 0) return;
          const chainId = multiChainIds[Math.floor(index / 2)];
          blockNumbersForChain[chainId] = {
            lastQueriedBlockNumber: results[index + 1],
            latestBlockNumber: results[index],
          };
        });
      }

      // Fetch last seen block for this chain and get the head block for the chosen chain, which we'll use to override the last queried block number
      // stored in GCP at the end of this hub execution.
      let [lastQueriedBlockNumber, latestBlockNumber] = await Promise.all([
        _getLastQueriedBlockNumber(req.body.configFile, chainId, logger),
        _getLatestBlockNumber(botWeb3),
      ]);

      // If the last queried block number stored on GCP Data Store is undefined, then its possible that this is
      // the first time that the hub is being run for this chain. Therefore, try setting it to the head block number
      // for the chosen node.
      if (!lastQueriedBlockNumber && latestBlockNumber) {
        lastQueriedBlockNumber = latestBlockNumber;
      }
      // If the last queried number is still undefined at this point, then exit with an error.
      else if (!lastQueriedBlockNumber)
        throw new Error(
          `No block number for chain ID stored on GCP and cannot read head block from node! chainID:${chainId} spokeCustomNodeUrl:${spokeCustomNodeUrl}`
        );

      // Store block number data for this chain ID which we'll use to update the GCP cache later.
      blockNumbersForChain[chainId] = {
        lastQueriedBlockNumber: Number(lastQueriedBlockNumber),
        latestBlockNumber: Number(latestBlockNumber),
      };
    }
    logger.debug({
      at: "ServerlessHub",
      message: "Updated block numbers for networks",
      nodeUrlToChainIdCache,
      blockNumbersForChain,
    });

    // Now, that we've precomputed all of the last seen blocks for each chain, we can update their values in the
    // GCP Data Store. These will all be the fetched as the "lastQueriedBlockNumber" in the next iteration when the
    // hub is called again.
    await _saveQueriedBlockNumber(req.body.configFile, blockNumbersForChain, logger);

    // Finally, loop over all config objects in the config file and for each append a call promise to the promiseArray.
    // Note that each promise is a race between the serverlessSpoke command and a `_rejectAfterDelay`. This places an
    // upper bound on how long each spoke can take to respond, acting as a timeout for each spoke call.
    let promiseArray = [];
    let botConfigs = {};
    for (const botName in configObject) {
      const [, spokeCustomNodeUrl] = _getWeb3AndUrlForBot(configObject[botName]);
      const chainId = nodeUrlToChainIdCache[spokeCustomNodeUrl];

      // Execute the spoke's command:
      const botConfig = _appendEnvVars(
        configObject[botName],
        botName,
        chainId,
        blockNumbersForChain,
        configObject[botName]?.environmentVariables?.STORE_MULTI_CHAIN_BLOCK_NUMBERS
      );
      botConfigs[botName] = botConfig;
      promiseArray.push(
        Promise.race([_executeServerlessSpoke(spokeUrl, botConfig), _rejectAfterDelay(spokeRejectionTimeout, botName)])
      );
    }
    logger.debug({ at: "ServerlessHub", message: "Executing Serverless spokes", botConfigs });

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
        retriedOutputs,
      });
      let rejectedRetryPromiseArray = [];
      retriedOutputs.forEach((botName) => {
        rejectedRetryPromiseArray.push(
          Promise.race([
            _executeServerlessSpoke(spokeUrl, botConfigs[botName]),
            _rejectAfterDelay(spokeRejectionTimeout, botName),
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
      output: { errorOutputs, validOutputs, retriedOutputs },
    });

    await delay(waitForLoggerDelay); // Wait a few seconds to be sure the the winston logs are processed upstream.
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
        output: errorOutput.stack,
        notificationPath: "infrastructure-error",
      });
    } else {
      // Else, the error was produced within one of the spokes. If this is the case then we need to process the errors a bit.
      logger.debug({
        at: "ServerlessHub",
        message: "Some spoke calls returned errors (details)🚨",
        output: errorOutput,
      });
      logger.error({
        at: "ServerlessHub",
        message: "Some spoke calls returned errors 🚨",
        retriedSpokes: errorOutput.retriedOutputs,
        errorOutputs: Object.keys(errorOutput.errorOutputs).map((spokeName) => {
          try {
            return {
              spokeName: spokeName,
              errorReported:
                errorOutput.errorOutputs[spokeName]?.execResponse?.stderr ??
                errorOutput.errorOutputs[spokeName].message ??
                errorOutput.errorOutputs[spokeName].reason ??
                errorOutput.errorOutputs[spokeName],
            };
          } catch (err) {
            return "Hub unable to parse error"; // `errorMessages` is in an unexpected JSON shape.
          }
        }), // eslint-disable-line indent
        validOutputs: Object.keys(errorOutput.validOutputs), // eslint-disable-line indent
        notificationPath: "infrastructure-error",
      });
    }

    await delay(waitForLoggerDelay); // Wait a few seconds to be sure the the winston logs are processed upstream.
    res
      .status(500)
      .send({
        message:
          errorOutput instanceof Error ? "A fatal error occurred in the hub" : "Some spoke calls returned errors",
        output: errorOutput instanceof Error ? errorOutput.message : errorOutput,
      });
  }
});

// Execute a serverless POST command on a given `url` with a provided json `body`. This is used to initiate the spoke
// instance from the hub. If running in gcp mode then local service account must be permissioned to execute this command.
const _executeServerlessSpoke = async (url, body) => {
  if (hubConfig.spokeRunner == "gcp") {
    const targetAudience = new URL(url).origin;

    const client = await auth.getIdTokenClient(targetAudience);
    const res = await client.request({ url: url, method: "post", data: body });

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
  let config;
  if (hubConfig.configRetrieval == "git") {
    const response = await fetch(
      `https://api.github.com/repos/${hubConfig.gitSettings.organization}/${hubConfig.gitSettings.repoName}/contents/${bucket}/${file}`,
      {
        method: "GET",
        headers: {
          Authorization: `token ${hubConfig.gitSettings.accessToken}`,
          "Content-type": "application/json",
          Accept: "application/vnd.github.v3.raw",
          "Accept-Charset": "utf-8",
        },
      }
    );
    config = await response.json(); // extract JSON from the http response
    // If there is a message in the config response then something went wrong in fetching from github api.
    if (config.message) throw new Error(`Could not fetch config! :${JSON.stringify(config)}`);
  }
  if (hubConfig.configRetrieval == "gcp") {
    const requestPromise = new Promise((resolve, reject) => {
      let buf = "";
      storage
        .bucket(bucket)
        .file(file)
        .createReadStream()
        .on("data", (d) => (buf += d))
        .on("end", () => resolve(buf))
        .on("error", (e) => reject(e));
    });
    config = JSON.parse(await requestPromise);
  } else if (hubConfig.configRetrieval == "localStorage") {
    const stringConfig = process.env[`${bucket}-${file}`];
    if (!stringConfig) {
      throw new Error(`No local storage stringConfig found for ${bucket}-${file}`);
    }
    config = JSON.parse(stringConfig);
  }

  // If the config contains a "commonConfig" field, append it it to all configs downstream and then remove common config
  // from the final config object. The config for a given bot will take precedence for each key. Use deep merge.
  if (Object.keys(config).includes("commonConfig")) {
    for (let configKey in config) {
      if (configKey != "commonConfig") config[configKey] = lodash.merge({}, config.commonConfig, config[configKey]);
    }
    delete config.commonConfig;
  }
  return config;
};

// Save a the last blocknumber seen by the hub to GCP datastore. BlockNumberLog is the entity kind and configIdentifier
// is the entity ID. Each entity has a column "<chainID>" which stores the latest block seen for a network.
async function _saveQueriedBlockNumber(configIdentifier, blockNumbersForChain, logger) {
  // Sometimes the GCP datastore can be flaky and return errors when fetching data. Use re-try logic to re-run on error.
  await retry(
    async () => {
      if (hubConfig.saveQueriedBlock == "gcp") {
        const key = datastore.key(["BlockNumberLog", configIdentifier]);
        const latestBlockNumbersForChain = {};
        Object.keys(blockNumbersForChain).forEach((chainId) => {
          latestBlockNumbersForChain[chainId] = blockNumbersForChain[chainId].latestBlockNumber;
        });
        const dataBlob = { key: key, data: latestBlockNumbersForChain };
        await datastore.save(dataBlob); // Overwrites the entire entity
      } else if (hubConfig.saveQueriedBlock == "localStorage") {
        Object.keys(blockNumbersForChain).forEach((chainId) => {
          process.env[`lastQueriedBlockNumber-${chainId}-${configIdentifier}`] =
            blockNumbersForChain[chainId].latestBlockNumber;
        });
      }
    },
    {
      retries: 2,
      minTimeout: 2000, // delay between retries in ms
      onRetry: (error) => {
        logger.debug({
          at: "serverlessHub",
          message: "An error was thrown when saving the previously queried block number - retrying",
          error: typeof error === "string" ? new Error(error) : error,
        });
      },
    }
  );
}

// Query entity kind `BlockNumberLog` with unique entity ID of `configIdentifier`. Used to get the last block number
// for a network ID recorded by the bot to inform where searches should start from. Each entity has a column for each
// chain ID storing the last seen block number for the corresponding network.
async function _getLastQueriedBlockNumber(configIdentifier, chainId, logger) {
  // sometimes the GCP datastore can be flaky and return errors when saving data. Use re-try logic to re-run on error.
  return await retry(
    async () => {
      if (hubConfig.saveQueriedBlock == "gcp") {
        const key = datastore.key(["BlockNumberLog", configIdentifier]);
        const [dataField] = await datastore.get(key);
        return dataField[chainId];
      } else if (hubConfig.saveQueriedBlock == "localStorage") {
        return process.env[`lastQueriedBlockNumber-${chainId}-${configIdentifier}`] | 0;
      }
    },
    {
      retries: 2,
      minTimeout: 2000, // delay between retries in ms
      onRetry: (error) => {
        logger.debug({
          at: "serverlessHub",
          message: "An error was thrown when fetching the most recent block number - retrying",
          error: typeof error === "string" ? new Error(error) : error,
        });
      },
    }
  );
}

function _getWeb3AndUrlForBot(botConfig) {
  const retryConfig = botConfig?.environmentVariables?.NODE_RETRY_CONFIG;
  if (retryConfig) {
    return [new Web3(createBasicProvider(retryConfig)), retryConfig[0].url];
  } else {
    const url = botConfig?.environmentVariables?.CUSTOM_NODE_URL || customNodeUrl;
    return [new Web3(url), url];
  }
}

async function _getBlockNumberOnChainIdMultiChain(botConfig, chainId) {
  return await new Web3(botConfig?.environmentVariables[`NODE_URL_${chainId}`]).eth.getBlockNumber();
}

// Get the latest block number from either `overrideNodeUrl` or `CUSTOM_NODE_URL`. Used to update the `
// lastSeenBlockNumber` after each run.
async function _getLatestBlockNumber(web3) {
  return await web3.eth.getBlockNumber();
}

async function _getChainId(web3) {
  return await web3.eth.getChainId();
}

// Add additional environment variables for a given config file. Used to attach starting and ending block numbers.
function _appendEnvVars(config, botName, chainId, blockNumbersForChain, multiChainBlocks) {
  // The starting block number should be one block after the last queried block number to not double report that block.
  config.environmentVariables["STARTING_BLOCK_NUMBER"] =
    Number(blockNumbersForChain[chainId].lastQueriedBlockNumber) + 1;
  config.environmentVariables["ENDING_BLOCK_NUMBER"] = blockNumbersForChain[chainId].latestBlockNumber;
  config.environmentVariables["BOT_IDENTIFIER"] = botName;
  if (multiChainBlocks)
    multiChainBlocks.forEach((chainId) => {
      config.environmentVariables[`STARTING_BLOCK_NUMBER_${chainId}`] =
        Number(blockNumbersForChain[chainId].lastQueriedBlockNumber) + 1;
      config.environmentVariables[`ENDING_BLOCK_NUMBER_${chainId}`] = blockNumbersForChain[chainId].latestBlockNumber;
    });
  return config;
}

// Execute a post query on a arbitrary `url` with a given json `body. Used to test the hub script locally.
async function _postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-type": "application/json", Accept: "application/json", "Accept-Charset": "utf-8" },
  });
  return await response.json(); // extract JSON from the http response
}

// Takes in a spokeResponse object for a given botKey and identifies if the response includes an error. If it does,
// append the error information to the errorOutputs. An error could be rejected from the spoke, timeout in the spoke,
// an error code from the spoke or the stdout is a blank string. If there is no error, append to validOutputs.
function _processSpokeResponse(botKey, spokeResponse, validOutputs, errorOutputs) {
  if (spokeResponse.status == "rejected" && spokeResponse.reason.status == "timeout") {
    errorOutputs[botKey] = { status: "timeout", message: spokeResponse.reason.message, botIdentifier: botKey };
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
      botIdentifier: botKey,
    };
  } else if (spokeResponse.value && spokeResponse.value.execResponse && spokeResponse.value.execResponse.stdout == "") {
    errorOutputs[botKey] = {
      status: spokeResponse.status,
      execResponse: spokeResponse.value && spokeResponse.value.execResponse,
      message: "empty stdout",
      botIdentifier: botKey,
    };
  } else if (
    spokeResponse.value &&
    spokeResponse.value.execResponse &&
    !JSON.stringify(spokeResponse.value.execResponse.stdout).includes("started")
  ) {
    errorOutputs[botKey] = {
      status: spokeResponse.status,
      execResponse: spokeResponse.value && spokeResponse.value.execResponse,
      message: "missing `started` keyword",
      botIdentifier: botKey,
    };
  } else {
    validOutputs[botKey] = {
      status: spokeResponse.status,
      execResponse: spokeResponse.value && spokeResponse.value.execResponse,
      botIdentifier: botKey,
    };
  }
}

// Returns a promise that is rejected after seconds delay. Used to limit how long a spoke can run for.
const _rejectAfterDelay = (seconds, childProcessIdentifier) =>
  new Promise((_, reject) => {
    setTimeout(reject, seconds * 1000, {
      status: "timeout",
      message: `The spoke call took longer than ${seconds} seconds to reply`,
      childProcessIdentifier,
    });
  });

// Start the hub's async listening process. Enables injection of a logging instance & port for testing.
async function Poll(_customLogger, port = 8080, _spokeURL, _CustomNodeUrl, _hubConfig) {
  customLogger = _customLogger;
  // The Serverless hub should have a configured URL to define the remote instance & a local node URL to boot.
  if (!_spokeURL || !_CustomNodeUrl) {
    throw new Error(
      "Bad environment! Specify a `SPOKE_URL` & `CUSTOM_NODE_URL` to point to the a Serverless spoke instance and an Ethereum node"
    );
  }

  // Use custom logger if passed in. Otherwise, create a local logger.
  const logger = customLogger || createNewLogger();

  // Set configs to be used in the sererless execution.
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
      env: process.env,
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

  Poll(null, process.env.PORT, process.env.SPOKE_URL, process.env.CUSTOM_NODE_URL, hubConfig).then(() => {});
}

hub.Poll = Poll;
module.exports = hub;
