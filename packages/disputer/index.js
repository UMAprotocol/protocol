#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");

// Helpers
const { MAX_UINT_VAL } = require("@uma/common");

// JS libs
const { Disputer } = require("./src/disputer");
const {
  ExpiringMultiPartyClient,
  GasEstimator,
  Logger,
  Networker,
  delay,
  waitForLogger,
  createReferencePriceFeedForEmp
} = require("@uma/financial-templates-lib");

// Truffle contracts.
const { getAbi, getAddress } = require("@uma/core");
const { getWeb3 } = require("@uma/common");

/**
 * @notice Continuously attempts to dispute liquidations in the EMP contract.
 * @param {Object} logger Module responsible for sending logs.
 * @param {String} address Contract address of the EMP.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Object} priceFeedConfig Configuration to construct the price feed object.
 * @param {Object} [disputerConfig] Configuration to construct the disputer.
 * @param {String} [disputerOverridePrice] Optional String representing a Wei number to override the disputer price feed.
 * @return None or throws an Error.
 */
async function run({
  logger,
  web3,
  empAddress,
  pollingDelay,
  errorRetries,
  errorRetriesTimeout,
  priceFeedConfig,
  disputerConfig,
  disputerOverridePrice
}) {
  try {
    const { toBN } = web3.utils;

    const getTime = () => Math.round(new Date().getTime() / 1000);

    // Setup web3 accounts and network
    const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);

    // Setup contract instances. NOTE that getAddress("Voting", networkId) will resolve to null in tests.
    const voting = new web3.eth.Contract(getAbi("Voting"), getAddress("Voting", networkId));
    const emp = new web3.eth.Contract(getAbi("ExpiringMultiParty"), empAddress);

    // Generate EMP properties to inform bot of important on-chain state values that we only want to query once.
    const [priceIdentifier, collateralTokenAddress, expirationTimestamp, contractTimestamp] = await Promise.all([
      emp.methods.priceIdentifier().call(),
      emp.methods.collateralCurrency().call(),
      emp.methods.expirationTimestamp().call(),
      emp.methods.getCurrentTime().call()
    ]);

    // If EMP is expired, exit early.
    if (contractTimestamp >= expirationTimestamp) {
      logger.info({
        at: "Disputer#index",
        message: "EMP is expired, cannot dispute any liquidations 🕰",
        expirationTimestamp,
        contractTimestamp
      });
      return;
    }

    const collateralToken = new web3.eth.Contract(getAbi("ExpandedERC20"), collateralTokenAddress);
    const [currentAllowance, collateralCurrencyDecimals] = await Promise.all([
      collateralToken.methods.allowance(accounts[0], empAddress).call(),
      collateralToken.methods.decimals().call()
    ]);

    // Price feed must use same # of decimals as collateral currency.
    let customPricefeedConfig = {
      ...priceFeedConfig,
      decimals: collateralCurrencyDecimals
    };

    const [priceFeed] = await Promise.all([
      createReferencePriceFeedForEmp(logger, web3, new Networker(logger), getTime, empAddress, customPricefeedConfig)
    ]);
    if (!priceFeed) {
      throw new Error("Price feed config is invalid");
    }
    logger.debug({
      at: "Disputer#index",
      message: `Using an ${customPricefeedConfig.decimals} decimal price feed`
    });

    // Generate EMP properties to inform bot of important on-chain state values that we only want to query once.
    const empProps = {
      priceIdentifier: priceIdentifier
    };

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "Disputer#index",
      message: "Disputer started🔎",
      empAddress,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      priceFeedConfig: customPricefeedConfig,
      disputerConfig,
      disputerOverridePrice
    });

    // Client and dispute bot.
    const empClient = new ExpiringMultiPartyClient(logger, getAbi("ExpiringMultiParty"), web3, empAddress);
    const gasEstimator = new GasEstimator(logger);
    const disputer = new Disputer({
      logger,
      expiringMultiPartyClient: empClient,
      votingContract: voting,
      gasEstimator,
      priceFeed,
      account: accounts[0],
      empProps,
      config: disputerConfig
    });

    // The EMP requires approval to transfer the disputer's collateral tokens in order to dispute a liquidation.
    // We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
    if (toBN(currentAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      await gasEstimator.update();
      const collateralApprovalTx = await collateralToken.methods.approve(empAddress, MAX_UINT_VAL).send({
        from: accounts[0],
        gasPrice: gasEstimator.getCurrentFastPrice()
      });
      logger.info({
        at: "Disputer#index",
        message: "Approved EMP to transfer unlimited collateral tokens 💰",
        collateralApprovalTx: collateralApprovalTx.transactionHash
      });
    }

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    while (true) {
      await retry(
        async () => {
          await disputer.update();
          await disputer.dispute(disputerOverridePrice);
          await disputer.withdrawRewards();
        },
        {
          retries: errorRetries,
          minTimeout: errorRetriesTimeout * 1000,
          randomize: false,
          onRetry: error => {
            logger.debug({
              at: "Disputer#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error
            });
          }
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({
          at: "Disputer#index",
          message: "End of serverless execution loop - terminating process"
        });
        await waitForLogger(logger);
        break;
      }
      logger.debug({
        at: "Disputer#index",
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

async function Poll(callback) {
  try {
    if (!process.env.EMP_ADDRESS) {
      throw new Error(
        "Bad input arg! Specify an `EMP_ADDRESS` for the location of the expiring Multi Party within your environment variables."
      );
    }

    // This object is spread when calling the `run` function below. It relies on the object enumeration order and must
    // match the order of parameters defined in the`run` function.
    const executionParameters = {
      empAddress: process.env.EMP_ADDRESS,
      // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60,
      // Default to 5 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 5,
      // Default to 10 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES__TIMEOUT ? Number(process.env.ERROR_RETRIES__TIMEOUT) : 10,
      // Read price feed configuration from an environment variable. This can be a crypto watch, medianizer or uniswap
      // price feed Config defines the exchanges to use. If not provided then the bot will try and infer a price feed
      // from the EMP_ADDRESS. EG with medianizer: {"type":"medianizer","pair":"ethbtc",
      // "lookback":7200, "minTimeBetweenUpdates":60,"medianizedFeeds":[{"type":"cryptowatch","exchange":"coinbase-pro"},
      // {"type":"cryptowatch","exchange":"binance"}]}
      priceFeedConfig: process.env.PRICE_FEED_CONFIG ? JSON.parse(process.env.PRICE_FEED_CONFIG) : null,
      // If there is a disputer config, add it. Else, set to null. This config contains disputeDelay and txnGasLimit. EG:
      // {"disputeDelay":60,"txnGasLimit":9000000}
      disputerConfig: process.env.DISPUTER_CONFIG ? JSON.parse(process.env.DISPUTER_CONFIG) : null,
      // If there is a DISPUTER_OVERRIDE_PRICE environment variable then the disputer will disregard the price from the
      // price feed and preform disputes at this override price. Use with caution as wrong input could cause invalid disputes.
      disputerOverridePrice: process.env.DISPUTER_OVERRIDE_PRICE
    };

    await run({ logger: Logger, web3: getWeb3(), ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "Disputer#index",
      message: "Disputer execution error🚨",
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
  Poll(nodeCallback)
    .then(() => {})
    .catch(nodeCallback);
}

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
