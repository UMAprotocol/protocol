#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");

// Helpers:
const { Networker, Logger, delay } = require("@uma/financial-templates-lib");

const { ContractNotifier } = require("./src/ContractNotifier");

/**
 * @notice Continuously attempts to monitor financial contracts and sends notifications.
 * @param {Object} logger Module responsible for sending logs.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Number} errorRetries The number of times the execution loop will re-try before throwing if an error occurs.
 * @param {Number} errorRetriesTimeout The amount of milliseconds to wait between re-try iterations on failed loops.
 * @param {Object} notifierConfig Configuration object to parameterize the contract notifier.
 * @return None or throws an Error.
 */
async function run({ logger, pollingDelay, errorRetries, errorRetriesTimeout, notifierConfig }) {
  try {
    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "ContractNotifier#index",
      message: "ContractNotifier started 🔔",
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      notifierConfig,
    });

    const getTime = () => Math.round(new Date().getTime() / 1000);

    const chainId = notifierConfig.chainId;
    const apiEndpoint = notifierConfig.apiEndpoint;
    const maxTimeTillExpiration = notifierConfig.maxTimeTillExpiration;
    const networker = new Networker(logger);

    const contractNotifier = new ContractNotifier({
      logger,
      networker,
      getTime,
      chainId,
      apiEndpoint,
      maxTimeTillExpiration,
    });

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    for (;;) {
      await retry(
        async () => {
          await contractNotifier.checkUpcomingExpirations();
          return;
        },
        {
          retries: errorRetries,
          minTimeout: errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: (error) => {
            logger.debug({
              at: "ContractNotifier#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error,
            });
          },
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({
          at: "ContractNotifier#index",
          message: "End of serverless execution loop - terminating process",
        });
        await delay(5); // Set a delay to let the transports flush fully.
        break;
      }
      logger.debug({
        at: "ContractNotifier#index",
        message: "End of execution loop - waiting polling delay",
        pollingDelay: `${pollingDelay} (s)`,
      });
      await delay(Number(pollingDelay));
    }
  } catch (error) {
    // If any error is thrown, catch it and bubble up to the main try-catch for error processing in the Poll function.
    throw typeof error === "string" ? new Error(error) : error;
  }
}

async function Poll(callback) {
  try {
    // This object is spread when calling the `run` function below. It relies on the object enumeration order and must
    // match the order of parameters defined in the`run` function.
    const executionParameters = {
      // Default to 1 hour delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 3600,
      // Default to 3 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 3,
      // Default to 1 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES_TIMEOUT ? Number(process.env.ERROR_RETRIES_TIMEOUT) : 1,
      // Notifier config contains all configuration settings for the notifier. This includes the following:
      // NOTIFIER_CONFIG={
      //  "maxTimeTillExpiration": 604800,                   // If time till expiration (in seconds) is below this fire the alert.
      //  "chainId": 1,                                      // Contracts deployment chain.
      //  "apiEndpoint": "https://prod.api.umaproject.org"   // API endpoint to check for contract information.
      // }
      notifierConfig: process.env.NOTIFIER_CONFIG ? JSON.parse(process.env.NOTIFIER_CONFIG) : {},
    };
    // Fill in notifierConfig defaults:
    executionParameters.notifierConfig = {
      maxTimeTillExpiration: 604800,
      chainId: 1,
      apiEndpoint: "https://prod.api.umaproject.org",
      ...executionParameters.notifierConfig,
    };

    await run({ logger: Logger, ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "ContractNotifier#index",
      message: "Contract notifier execution error🚨",
      error: typeof error === "string" ? new Error(error) : error,
      notificationPath: "infrastructure-error",
    });
    await delay(5); // Set a delay to let the transports flush fully.
    callback(error);
  }
  callback();
}

function nodeCallback(err) {
  if (err) {
    console.error(err);
    process.exit(1);
  } else process.exit(0);
}

// If called directly by node, execute the Poll Function. This lets the script be run as a node process.
if (require.main === module) {
  Poll(nodeCallback)
    .then(() => {})
    .catch(nodeCallback);
}

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
