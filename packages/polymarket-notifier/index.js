#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");

// Helpers:
const { Logger, delay } = require("@uma/financial-templates-lib");

const { PolymarketNotifier } = require("./src/polymarketNotifier");

const { getWeb3 } = require("@uma/common");

/**
 * @notice Continuously attempts to monitor OO contract proposals and sends notifications.
 * @param {Object} logger Module responsible for sending logs.
 * @param {Object} web3 web3.js instance with unlocked wallets used for all on-chain connections.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Number} errorRetries The number of times the execution loop will re-try before throwing if an error occurs.
 * @param {Number} errorRetriesTimeout The amount of milliseconds to wait between re-try iterations on failed loops.
 * @param {Object} notifierConfig Configuration object to parameterize the contract notifier.
 * @return None or throws an Error.
 */
async function run({ logger, web3, pollingDelay, errorRetries, errorRetriesTimeout, notifierConfig }) {
  try {
    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "PolymarketNotifier#index",
      message: "PolymarketNotifier started 🔔",
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      notifierConfig,
    });

    const getTime = () => Math.round(new Date().getTime() / 1000);

    const apiEndpoint = notifierConfig.apiEndpoint;
    const minAcceptedPrice = notifierConfig.minAcceptedPrice;
    const minMarketLiquidity = notifierConfig.minMarketLiquidity;
    const minMarketVolume = notifierConfig.minMarketVolume;

    const polymarketNotifier = new PolymarketNotifier({
      logger,
      web3,
      getTime,
      apiEndpoint,
      minAcceptedPrice,
      minMarketLiquidity,
      minMarketVolume,
    });

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    for (;;) {
      await retry(
        async () => {
          await polymarketNotifier.checkRecentProposals();
          return;
        },
        {
          retries: errorRetries,
          minTimeout: errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: (error) => {
            logger.debug({
              at: "PolymarketNotifier#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error,
            });
          },
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({
          at: "PolymarketNotifier#index",
          message: "End of serverless execution loop - terminating process",
        });
        await delay(5); // Set a delay to let the transports flush fully.
        break;
      }
      logger.debug({
        at: "PolymarketNotifier#index",
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
      // Default to 10 minute delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 600,
      // Default to 3 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 3,
      // Default to 1 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES_TIMEOUT ? Number(process.env.ERROR_RETRIES_TIMEOUT) : 1,
      // Notifier config contains all configuration settings for the notifier. This includes the following:
      // NOTIFIER_CONFIG={
      //  "minAcceptedPrice": 0.99,                         // If the Polymarket API price is below this value at the time of a proposal an alert is sent.
      //  "apiEndpoint": "https://gamma-api.polymarket.com/query",   // API endpoint to check for Polymarket information.
      //  "minMarketLiquidity": 1000,                       // Minimum market liquidity that determines if alert is sent.
      //  "minMarketVolume": 750                           // Minimum market volume that determines if alert is sent.
      // }
      notifierConfig: process.env.NOTIFIER_CONFIG ? JSON.parse(process.env.NOTIFIER_CONFIG) : {},
    };
    // Fill in notifierConfig defaults:
    executionParameters.notifierConfig = {
      apiEndpoint: "https://gamma-api.polymarket.com/query",
      minAcceptedPrice: 0.95,
      minMarketLiquidity: 500,
      minMarketVolume: 500,
      ...executionParameters.notifierConfig,
    };

    await run({ logger: Logger, web3: getWeb3(), ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "PolymarketNotifier#index",
      message: "Polymarket notifier execution error🚨",
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
