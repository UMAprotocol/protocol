#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");

const {
  Logger,
  delay,
  FinancialContractFactoryClient,
  GasEstimator,
  multicallAddressMap,
} = require("@uma/financial-templates-lib");
const { FundingRateProposer } = require("./src/proposer");

// Contract ABIs and network Addresses.
const { getAbi, getAddress } = require("@uma/contracts-node");
const { getWeb3, PublicNetworks } = require("@uma/common");

/**
 * @notice Runs strategies that request and propose new funding rates for Perpetual contracts.
 * @param {Object} logger Module responsible for sending logs.
 * @param {Object} web3 web3.js instance with unlocked wallets used for all on-chain connections.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Number} errorRetries The number of times the execution loop will re-try before throwing if an error occurs.
 * @param {Number} errorRetriesTimeout The amount of milliseconds to wait between re-try iterations on failed loops.
 * @param {Object} [commonPriceFeedConfig] Common configuration to pass to all PriceFeeds constructed by proposer.
 * @param {Object} [perpetualProposerConfig] Configuration to construct the Perpetual funding rate proposer.
 * @param {Address} [multicallAddress] Overrides default multicall contract fetched from detected provider's
 *     network.
 * @param {Boolean} [isTest] If set to true, then proposer bot will use the pricefeed's `lastUpdateTime` as the
 *     request timestamp instead of `web3.eth.getBlock('latest').timestamp`.
 * @return None or throws an Error.
 */
async function run({
  logger,
  web3,
  pollingDelay,
  errorRetries,
  errorRetriesTimeout,
  commonPriceFeedConfig,
  perpetualProposerConfig,
  multicallAddress,
  isTest = false,
}) {
  try {
    const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);
    const networkName = PublicNetworks[Number(networkId)] ? PublicNetworks[Number(networkId)].name : null;

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "PerpetualFundingRateProposer#index",
      message: "Perpetual funding rate proposer started 🌝",
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      commonPriceFeedConfig,
      perpetualProposerConfig,
      multicallAddress,
    });

    // Create the FinancialContractFactoryClient to query on-chain information,
    // GasEstimator to get latest gas prices and an instance of the funding rate proposer to
    // respond to price requests and proposals.
    const perpetualFactoryClient = new FinancialContractFactoryClient(
      logger,
      getAbi("PerpetualCreator"),
      web3,
      await getAddress("PerpetualCreator", networkId),
      0 // Force startingBlock=0 so we can get ALL deployed contracts.
      // Leave endingBlock=null so that we can get all events up to latest block.
    );
    const gasEstimator = new GasEstimator(logger, 60, networkId);

    // The proposer needs to query prices for any identifier approved to use the Optimistic Oracle,
    // so a new pricefeed is constructed for each identifier. This `commonPriceFeedConfig` contains
    // properties that are shared across all of these new pricefeeds.
    const multicallContractAddress =
      multicallAddress || (networkName ? multicallAddressMap[networkName].multicall : null);
    const fundingRateProposer = new FundingRateProposer({
      logger,
      perpetualFactoryClient,
      multicallContractAddress: multicallContractAddress,
      gasEstimator,
      account: accounts[0],
      commonPriceFeedConfig,
      perpetualProposerConfig,
    });

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    for (;;) {
      await retry(
        async () => {
          await fundingRateProposer.update();
          await fundingRateProposer.updateFundingRates(isTest);
          return;
        },
        {
          retries: errorRetries,
          minTimeout: errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: (error) => {
            logger.debug({
              at: "PerpetualFundingRateProposer#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error,
            });
          },
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({
          at: "PerpetualFundingRateProposer#index",
          message: "End of serverless execution loop - terminating process",
        });

        await delay(5); // Set a delay to let the transports flush fully.
        break;
      }
      logger.debug({
        at: "PerpetualFundingRateProposer#index",
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
      // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60,
      // Default to 3 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 3,
      // Default to 10 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES_TIMEOUT ? Number(process.env.ERROR_RETRIES_TIMEOUT) : 1,
      // Common price feed configuration passed along to all those constructed by proposer.
      commonPriceFeedConfig: process.env.COMMON_PRICE_FEED_CONFIG
        ? JSON.parse(process.env.COMMON_PRICE_FEED_CONFIG)
        : {},
      // If there is a perpetual proposer config, add it. Else, set to null. Example config:
      // {
      //   "fundingRateErrorPercent":0.05 ->  Current funding rates (as stored in the OptimisticOracle)
      //                                      that do not equal the bot's queried funding rate
      //                                      within this error % will be requested to be updated,
      //                                      and proposed to.
      //                                      e.g. 0.05 implies 5% margin of error.
      //  }
      perpetualProposerConfig: process.env.PERPETUAL_PROPOSER_CONFIG
        ? JSON.parse(process.env.PERPETUAL_PROPOSER_CONFIG)
        : {},
      // Overrides the default multicall contract fetched for the detected provider's network. This param is useful
      // primarily for test networks which do not have a default multicall contract already deployed.
      multicallAddress: process.env.MULTICALL_ADDRESS ? process.env.MULTICALL_ADDRESS : null,
    };

    await run({ logger: Logger, web3: getWeb3(), ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "PerpetualFundingRateProposer#index",
      message: "Perpetual funding rate proposer execution error🚨",
      error: typeof error === "string" ? new Error(error) : error,
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
