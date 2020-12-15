#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");
const { Logger, waitForLogger, delay } = require("@uma/financial-templates-lib");

/**
 * @notice Main runner program that executes a one-time setup module followed by a continuously polling module
 * to propose prices. This runner can be used to run liquidators, disputers, and price proposers to the Optimistic
 * Oracle for example.
 * @param {Object} logger Module responsible for sending logs.
 * @param {Function} setupFunc Async module to run once to set up for the polling module.
 * @param {Function} pollingFunc Async module to poll continuously.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Number} errorRetries The number of times the polling loop will re-try before throwing if an error occurs.
 * @param {Number} errorRetriesTimeout The amount of milliseconds to wait between re-try iterations on failed loops.
 * @param {Object} config General configuration params passed to setupFunc and pollingFunc.
 * @return None or throws an Error.
 */
async function run({ logger, setupFunc, pollingFunc, pollingDelay, errorRetries, errorRetriesTimeout, config }) {
  try {
    // TODO: Should we set default values for the required fields in `config` and use the
    // `createObjectFromDefaultProps` function?
    // Check required `config` params:
    if (!config.name) {
      throw new Error("Invalid config! Specify a `name` to use for logging.");
    }

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: `${config.name}#run`,
      message: `${config.name} started 🌊`,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      config
    });

    // Run the setup script
    await setupFunc(logger, config);

    // Poll indefinitely (or yield early if in serverless mode)
    for (;;) {
      await retry(pollingFunc, {
        retries: errorRetries,
        minTimeout: errorRetriesTimeout * 1000, // delay between retries in ms
        randomize: false,
        onRetry: error => {
          logger.debug({
            at: `${config.name}#run`,
            message: "An error was thrown in the execution loop - retrying",
            error: typeof error === "string" ? new Error(error) : error
          });
        }
      });
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({
          at: `${config.name}#run`,
          message: "End of serverless execution loop - terminating process"
        });
        await waitForLogger(logger);
        break;
      }
      logger.debug({
        at: `${config.name}#run`,
        message: "End of execution loop - waiting polling delay",
        pollingDelay: `${pollingDelay} (s)`
      });
      await delay(Number(pollingDelay));
    }
  } catch (error) {
    // If any error is thrown, catch it and bubble up to the main try-catch for error processing in the Poll function.
    throw typeof error === "string" ? new Error(error) : error;
  }
}

async function Main(callback) {
  try {
    // This object is spread when calling the `run` function below. It relies on the object enumeration order and must
    // match the order of parameters defined in the `run` function.
    const executionParameters = {
      // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60,
      // Default to 3 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 5,
      // Default to 10 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES_TIMEOUT ? Number(process.env.ERROR_RETRIES_TIMEOUT) : 10,
      // This config is passed to the setupFunc and pollingFunc that are executed by the `run`, and they are
      // responsible for validating the additional config options. The required config options are:
      // {
      //     "name": String,  -> Name of the strategy to run, used in logging
      // }
      config: process.env.CONFIG ? JSON.parse(process.env.CONFIG) : null
    };

    await run({ logger: Logger, ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "index",
      message: "Main execution error🚨",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(Logger);
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
  Main(nodeCallback)
    .then(() => {})
    .catch(nodeCallback);
}

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
Main.run = run;
module.exports = Main;
