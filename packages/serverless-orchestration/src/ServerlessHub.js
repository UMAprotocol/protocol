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
 * 3) SPOKE_URLS: An optional argument in the form of a stringified JSON Object in the form of Record<string,string>
 * Keys are a name for the spoke, and values are the spoke urls. This is only needed when we want to specificy
 * different spoke urls for each configuration. Select by using the parameter "spokeUrlName" on the config file for each bot.
 * 4) CUSTOM_NODE_URL: an ethereum node used to fetch the latest block number when the script runs.
 * 5) HUB_CONFIG: JSON object configuring configRetrieval to define where to pull configs from, saveQueriedBlock to
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
const fetchWithRetry = require("fetch-retry")(fetch);
const { URL } = require("url");
const lodash = require("lodash");

// GCP helpers.
const { GoogleAuth } = require("google-auth-library"); // Used to get authentication headers to execute cloud run & cloud functions.
const auth = new GoogleAuth();
const { Storage } = require("@google-cloud/storage"); // Used to get global config objects to parameterize bots.

const { WAIT_FOR_LOGGER_DELAY, GCP_STORAGE_CONFIG } = process.env;

// Enabling retry in case of transient timeout issues.
const DEFAULT_RETRIES = 1;

// Assign key name to variable since it's referenced multiple times.
const RUN_IDENTIFIER_KEY = "RUN_IDENTIFIER";

// Allows the environment to customize the config that's used to interact with google cloud storage.
// Relevant options can be found here: https://googleapis.dev/nodejs/storage/latest/global.html#StorageOptions.
// Specific fields of interest:
// - timeout: allows the env to set the timeout for all http requests.
// - retryOptions: object that allows the caller to specify how the library retries.
const storageConfig = GCP_STORAGE_CONFIG
  ? JSON.parse(GCP_STORAGE_CONFIG)
  : { autoRetry: true, maxRetries: DEFAULT_RETRIES };
const storage = new Storage(storageConfig);

const { Datastore } = require("@google-cloud/datastore"); // Used to read/write the last block number the monitor used.
const datastore = new Datastore();
const { createBasicProvider } = require("@uma/common");

// Web3 instance to get current block numbers of polling loops.
const Web3 = require("web3");

const { delay, createNewLogger, generateRandomRunId } = require("@uma/financial-templates-lib");
let customLogger;
let spokeUrl;
// spokeUrlTable is an optional table populated through the env var SPOKE_URLS. SPOKE_URLS is expected to be a
// stringified JSON object in the form Record<string:string>. Where keys are a name for the spoke url
// and the values are the spoke urls. The env gets parsed into spokeUrlTable.  Bots can select a size with
// the spokeUrlName="large" on the configuration object.
// For Example:
// {
//   large:"https://large-spoke-url",
//   small:"https://small-spoke-url",
// }
let spokeUrlTable = {};
let customNodeUrl;
let hubConfig = {};

// Lets us specify spoke url by a name or fallback to default spoke pool url.
// this should allow us to create multiple levels of spoke pool hardware (small,medium,large)
// and switch between urls based on the bot config.
function getSpokeUrl(name) {
  if (name) {
    // this will check if you have specified a name, and do a lookup. If a name is specified but does not exist this
    // will be an error
    const url = spokeUrlTable?.[name];
    if (!url) throw new Error("No valid spoke url available for name: " + name);
    return url;
    // if no name specified just return spokeUrl. This may possibly be undefined, but this is compatible with past
    // behavior.
  } else return spokeUrl;
}

const defaultHubConfig = {
  configRetrieval: "localStorage",
  saveQueriedBlock: "localStorage",
  spokeRunner: "localStorage",
  rejectSpokeDelay: 120, // 2 min.
};

const waitForLoggerDelay = WAIT_FOR_LOGGER_DELAY || 5;

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
      spokeUrlTable,
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

      const singleChainId = await _getChainId(botWeb3);

      // Cache the chain id for this node url.
      nodeUrlToChainIdCache[spokeCustomNodeUrl] = singleChainId;

      // Fetch last seen block for this chain and get the head block for the chosen chain, which we'll use to override the last queried block number
      // stored in GCP at the end of this hub execution. Fetch only if we haven't cached them already.
      // Keep them as promises as we might still have multichain block numbers to fetch.
      let blockNumberPromises = [];
      if (!blockNumbersForChain[singleChainId]) {
        blockNumberPromises.push(
          _getLastQueriedBlockNumber(req.body.configFile, singleChainId, logger),
          _getLatestBlockNumber(botWeb3),
          new Promise((resolve) => {
            resolve(singleChainId);
          })
        );
      }

      // If STORE_MULTI_CHAIN_BLOCK_NUMBERS is set then this bot requires to know a number of last seen blocks across
      // a set of chainIds. Append a batch promise to evaluate the latest block number for each chainId.
      if (configObject[botName]?.environmentVariables?.STORE_MULTI_CHAIN_BLOCK_NUMBERS) {
        const multiChainIds = configObject[botName]?.environmentVariables?.STORE_MULTI_CHAIN_BLOCK_NUMBERS;
        for (const chainId of multiChainIds) {
          // If we've seen this chain ID or it is covered by the singleChainId we can skip it.
          if (blockNumbersForChain[chainId] || chainId === singleChainId) continue;

          blockNumberPromises.push(
            _getLastQueriedBlockNumber(req.body.configFile, chainId, logger),
            _getBlockNumberOnChainIdMultiChain(configObject[botName], chainId),
            new Promise((resolve) => {
              resolve(chainId);
            })
          );
        }
      }

      const blockNumberResults = await Promise.all(blockNumberPromises);
      blockNumberResults.forEach((_, index) => {
        // This is flat array where each chain has 3 elements (lastQueriedBlockNumber, latestBlockNumber and chainId).
        if (index % 3 !== 0) return;
        let [lastQueriedBlockNumber, latestBlockNumber, chainId] = blockNumberResults.slice(index, index + 3);

        // If the last queried block number stored on GCP Data Store is undefined, then its possible that this is
        // the first time that the hub is being run for this chain. Therefore, try setting it to the head block number
        // for the chosen node.
        if (!lastQueriedBlockNumber && latestBlockNumber) {
          lastQueriedBlockNumber = latestBlockNumber;
        }
        // If the last queried number is still undefined at this point, then exit with an error.
        else if (!lastQueriedBlockNumber)
          throw new Error(
            `No block number for chain ID stored on GCP and cannot read head block from node! chainID:${chainId}`
          );

        // Store block number data for this chain ID which we'll use to update the GCP cache later.
        blockNumbersForChain[chainId] = {
          lastQueriedBlockNumber: Number(lastQueriedBlockNumber),
          latestBlockNumber: Number(latestBlockNumber),
        };
      });
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
      const singleChainId = nodeUrlToChainIdCache[spokeCustomNodeUrl];

      // Execute the spoke's command:
      const botConfig = _appendEnvVars(
        configObject[botName],
        botName,
        singleChainId,
        blockNumbersForChain,
        configObject[botName]?.environmentVariables?.STORE_MULTI_CHAIN_BLOCK_NUMBERS
      );
      botConfigs[botName] = botConfig;
      // Gets a spoke url based on execution size or fallback to default spoke url if non specified
      if (botConfig.spokeUrlName)
        logger.debug({
          at: "ServerlessHub",
          message: `Attempting to execute ${botName} serverless spoke using named spoke ${botConfig.spokeUrlName}`,
        });
      const spokeUrl = getSpokeUrl(botConfig.spokeUrlName);
      const runId = botConfig.environmentVariables[RUN_IDENTIFIER_KEY];
      promiseArray.push(
        Promise.race([
          _executeServerlessSpoke(spokeUrl, botConfig, botName),
          _rejectAfterDelay(spokeRejectionTimeout, botName),
        ]).then(
          (value) => ({ ...value, runIds: [runId] }),
          (err) => Promise.reject({ ...err, runIds: [runId] })
        )
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
        const spokeUrl = getSpokeUrl(botConfigs[botName].spokeUrlName);

        // Swap out the run identifer for one with an `r` appended to signify a retry.
        const runId = botConfigs[botName].environmentVariables[RUN_IDENTIFIER_KEY];
        const retryRunId = `${runId}r`;
        botConfigs[botName].environmentVariables[RUN_IDENTIFIER_KEY] = retryRunId;

        rejectedRetryPromiseArray.push(
          Promise.race([
            _executeServerlessSpoke(spokeUrl, botConfigs[botName], botName),
            _rejectAfterDelay(spokeRejectionTimeout, botName),
          ]).then(
            (value) => ({ ...value, runIds: [runId, retryRunId] }),
            (err) => Promise.reject({ ...err, runIds: [runId, retryRunId] })
          )
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
    // Note: we don't log the error outputs since it is empty in this branch.
    logger.debug({
      at: "ServerlessHub",
      message: "All calls returned correctly",
      output: { validOutputs: Object.keys(validOutputs), retriedOutputs },
    });

    // Log each bot's output separately to avoid creating huge log messages.
    // Note: no need to loop through errorOutputs since the length has been
    for (const [botName, output] of Object.entries(validOutputs)) {
      logger.debug({ at: "ServerlessHub", message: `Bot ${botName} succeeded`, output });
    }

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
    res.status(500).send({
      message: errorOutput instanceof Error ? "A fatal error occurred in the hub" : "Some spoke calls returned errors",
      output: errorOutput instanceof Error ? errorOutput.message : errorOutput,
    });
  }
});

// Execute a serverless POST command on a given `url` with a provided json `body`. This is used to initiate the spoke
// instance from the hub. If running in gcp mode then local service account must be permissioned to execute this command.
const _executeServerlessSpoke = async (url, body, botName) => {
  try {
    if (hubConfig.spokeRunner == "gcp") {
      const targetAudience = new URL(url).origin;

      const client = await auth.getIdTokenClient(targetAudience);
      const res = await client.request({ url: url, method: "post", data: body });

      return res.data;
    } else if (hubConfig.spokeRunner == "localStorage") {
      return _postJson(url, body);
    }
  } catch (err) {
    return Promise.reject({ status: "error", message: err.toString(), childProcessIdentifier: botName });
  }
};

// Fetch configs for serverless hub. Either read from a gcp bucket, local storage or a git repo. Github configs can pull
// from a private github repo using the provided Authorization token. GCP uses a readStream which is converted into a
// buffer such that the config file does not need to first be downloaded from the bucket. This will use the local service
// account. Local configs are read directly from the process's environment variables.
const _fetchConfig = async (bucket, file) => {
  let config;
  if (hubConfig.configRetrieval == "git") {
    const response = await fetchWithRetry(
      `https://api.github.com/repos/${hubConfig.gitSettings.organization}/${hubConfig.gitSettings.repoName}/contents/${bucket}/${file}`,
      {
        method: "GET",
        headers: {
          Authorization: `token ${hubConfig.gitSettings.accessToken}`,
          "Content-type": "application/json",
          Accept: "application/vnd.github.v3.raw",
          "Accept-Charset": "utf-8",
        },
        retries: DEFAULT_RETRIES,
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

function _getBlockNumberOnChainIdMultiChain(botConfig, chainId) {
  const urls = botConfig?.environmentVariables?.[`NODE_URLS_${chainId}`]
    ? botConfig.environmentVariables[`NODE_URLS_${chainId}`]
    : botConfig?.environmentVariables?.[`NODE_URL_${chainId}`];
  if (!urls)
    throw new Error(
      `ServerlessHub::_getBlockNumberOnChainIdMultiChain NODE_URLS_${chainId} or NODE_URL_${chainId} in botConfig: ${botConfig}`
    );

  const retryConfig = lodash.castArray(urls).map((url) => ({ url }));
  const retryWeb3 = new Web3(createBasicProvider(retryConfig));
  return retryWeb3.eth.getBlockNumber();
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
function _appendEnvVars(config, botName, singleChainId, blockNumbersForChain, multiChainBlocks) {
  // The starting block number should be one block after the last queried block number to not double report that block.
  config.environmentVariables["STARTING_BLOCK_NUMBER"] =
    Number(blockNumbersForChain[singleChainId].lastQueriedBlockNumber) + 1;
  config.environmentVariables["ENDING_BLOCK_NUMBER"] = blockNumbersForChain[singleChainId].latestBlockNumber;
  config.environmentVariables["BOT_IDENTIFIER"] = botName;
  config.environmentVariables[RUN_IDENTIFIER_KEY] = generateRandomRunId();
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
    errorOutputs[botKey] = {
      status: "timeout",
      message: spokeResponse.reason.message,
      botIdentifier: botKey,
      runIds: spokeResponse.reason.runIds,
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
      botIdentifier: botKey,
      runIds: spokeResponse?.reason?.runIds || spokeResponse?.value?.runIds,
    };
  } else if (spokeResponse.value && spokeResponse.value.execResponse && spokeResponse.value.execResponse.stdout == "") {
    errorOutputs[botKey] = {
      status: spokeResponse.status,
      execResponse: spokeResponse.value && spokeResponse.value.execResponse,
      message: "empty stdout",
      botIdentifier: botKey,
      runIds: spokeResponse.value.runIds,
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
      runIds: spokeResponse.value.runIds,
    };
  } else {
    validOutputs[botKey] = {
      status: spokeResponse.status,
      execResponse: spokeResponse.value && spokeResponse.value.execResponse,
      botIdentifier: botKey,
      runIds: spokeResponse?.value?.runIds,
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
async function Poll(_customLogger, port = 8080, _spokeURL, _CustomNodeUrl, _hubConfig, spokeURLS) {
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
  // This should be specified as an object Record<size:string,url:string>
  spokeUrlTable = spokeURLS;
  customNodeUrl = _CustomNodeUrl;
  if (_hubConfig) hubConfig = { ...defaultHubConfig, ..._hubConfig };
  else hubConfig = defaultHubConfig;

  return hub.listen(port, () => {
    logger.debug({
      at: "ServerlessHub",
      message: "Serverless hub initialized",
      spokeUrl,
      spokeUrlTable,
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
  let hubConfig;
  try {
    hubConfig = process.env.HUB_CONFIG ? JSON.parse(process.env.HUB_CONFIG) : null;
  } catch (error) {
    console.error("Malformed hub config!", hubConfig);
    process.exit(1);
  }
  let spokeURLS;
  try {
    spokeURLS = process.env.SPOKE_URLS ? JSON.parse(process.env.SPOKE_URLS) : {};
  } catch (error) {
    console.error("Malformed SPOKE_URLS env!");
    process.exit(1);
  }

  Poll(null, process.env.PORT, process.env.SPOKE_URL, process.env.CUSTOM_NODE_URL, hubConfig, spokeURLS).then(() => {});
}

hub.Poll = Poll;
module.exports = hub;
