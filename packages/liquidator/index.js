#!/usr/bin/env node

require("dotenv").config();
const retry = require("async-retry");

// Helpers
const { MAX_UINT_VAL } = require("@uma/common");
// JS libs
const { ONE_SPLIT_ADDRESS } = require("./src/constants");
const { OneInchExchange } = require("./src/OneInchExchange");
const { Liquidator } = require("./src/liquidator");
const {
  GasEstimator,
  ExpiringMultiPartyClient,
  Networker,
  Logger,
  createReferencePriceFeedForEmp,
  waitForLogger,
  delay
} = require("@uma/financial-templates-lib");

// Contract ABIs and network Addresses.
const { getAbi, getAddress } = require("@uma/core");
const { getWeb3 } = require("@uma/common");

/**
 * @notice Continuously attempts to liquidate positions in the EMP contract.
 * @param {Object} logger Module responsible for sending logs.
 * @param {Object} web3 web3.js instance with unlocked wallets used for all on-chain connections.
 * @param {String} empAddress Contract address of the EMP.
 * @param {String} oneSplitAddress Contract address of OneSplit.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Number} errorRetries The number of times the execution loop will re-try before throwing if an error occurs.
 * @param {Number} errorRetriesTimeout The amount of milliseconds to wait between re-try iterations on failed loops.
 * @param {Object} priceFeedConfig Configuration to construct the price feed object.
 * @param {Object} [liquidatorConfig] Configuration to construct the liquidator.
 * @param {String} [liquidatorOverridePrice] Optional String representing a Wei number to override the liquidator price feed.
 * @return None or throws an Error.
 */
async function run({
  logger,
  web3,
  empAddress,
  oneSplitAddress,
  pollingDelay,
  errorRetries,
  errorRetriesTimeout,
  priceFeedConfig,
  liquidatorConfig,
  liquidatorOverridePrice
}) {
  try {
    const { toBN } = web3.utils;

    const getTime = () => Math.round(new Date().getTime() / 1000);

    // Load unlocked web3 accounts and get the networkId.
    const [accounts, networkId] = await Promise.all([web3.eth.getAccounts(), web3.eth.net.getId()]);

    // Setup contract instances. NOTE that getAddress("Voting", networkId) will resolve to null in tests.
    const voting = new web3.eth.Contract(getAbi("Voting"), getAddress("Voting", networkId));
    const emp = new web3.eth.Contract(getAbi("ExpiringMultiParty"), empAddress);

    // Generate EMP properties to inform bot of important on-chain state values that we only want to query once.
    const [
      collateralRequirement,
      priceIdentifier,
      minSponsorTokens,
      collateralTokenAddress,
      syntheticTokenAddress,
      expirationTimestamp,
      contractTimestamp
    ] = await Promise.all([
      emp.methods.collateralRequirement().call(),
      emp.methods.priceIdentifier().call(),
      emp.methods.minSponsorTokens().call(),
      emp.methods.collateralCurrency().call(),
      emp.methods.tokenCurrency().call(),
      emp.methods.expirationTimestamp().call(),
      emp.methods.getCurrentTime().call()
    ]);

    // If EMP is expired, exit early.
    if (contractTimestamp >= expirationTimestamp) {
      logger.info({
        at: "Liquidator#index",
        message: "EMP is expired, cannot liquidate any positions 🕰",
        expirationTimestamp,
        contractTimestamp
      });
      return;
    }

    const collateralToken = new web3.eth.Contract(getAbi("ExpandedERC20"), collateralTokenAddress);
    const syntheticToken = new web3.eth.Contract(getAbi("ExpandedERC20"), syntheticTokenAddress);
    const [currentCollateralAllowance, currentSyntheticAllowance, collateralCurrencyDecimals] = await Promise.all([
      collateralToken.methods.allowance(accounts[0], empAddress).call(),
      syntheticToken.methods.allowance(accounts[0], empAddress).call(),
      collateralToken.methods.decimals().call()
    ]);

    const empProps = {
      crRatio: collateralRequirement,
      priceIdentifier: priceIdentifier,
      minSponsorSize: minSponsorTokens
    };

    // Price feed must use same # of decimals as collateral currency.
    let customPricefeedConfig = {
      ...priceFeedConfig,
      decimals: collateralCurrencyDecimals
    };

    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "Liquidator#index",
      message: "Liquidator started 🌊",
      empAddress,
      pollingDelay,
      errorRetries,
      errorRetriesTimeout,
      priceFeedConfig: customPricefeedConfig,
      liquidatorConfig,
      liquidatorOverridePrice
    });

    // Load unlocked web3 accounts, get the networkId and set up price feed.
    const [priceFeed] = await Promise.all([
      createReferencePriceFeedForEmp(logger, web3, new Networker(logger), getTime, empAddress, customPricefeedConfig)
    ]);
    if (!priceFeed) {
      throw new Error("Price feed config is invalid");
    }
    logger.debug({
      at: "Liquidator#index",
      message: `Using an ${customPricefeedConfig.decimals} decimal price feed`
    });

    // Create the ExpiringMultiPartyClient to query on-chain information, GasEstimator to get latest gas prices and an
    // instance of Liquidator to preform liquidations.
    const empClient = new ExpiringMultiPartyClient(logger, getAbi("ExpiringMultiParty"), web3, empAddress);
    const gasEstimator = new GasEstimator(logger);

    let oneInchClient = null;
    if (oneSplitAddress) {
      oneInchClient = new OneInchExchange({
        web3,
        gasEstimator,
        logger,
        oneSplitAbi: getAbi("OneSplit"),
        erc20TokenAbi: getAbi("ExpandedERC20"),
        oneSplitAddress
      });
    }

    const liquidator = new Liquidator({
      logger,
      oneInchClient,
      expiringMultiPartyClient: empClient,
      gasEstimator,
      votingContract: voting,
      syntheticToken,
      priceFeed,
      account: accounts[0],
      empProps,
      liquidatorConfig
    });

    // The EMP requires approval to transfer the liquidator's collateral and synthetic tokens in order to liquidate
    // a position. We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
    if (toBN(currentCollateralAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      await gasEstimator.update();
      const collateralApprovalTx = await collateralToken.methods.approve(empAddress, MAX_UINT_VAL).send({
        from: accounts[0],
        gasPrice: gasEstimator.getCurrentFastPrice()
      });
      logger.info({
        at: "Liquidator#index",
        message: "Approved EMP to transfer unlimited collateral tokens 💰",
        collateralApprovalTx: collateralApprovalTx.transactionHash
      });
    }
    if (toBN(currentSyntheticAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      await gasEstimator.update();
      const syntheticApprovalTx = await syntheticToken.methods.approve(empAddress, MAX_UINT_VAL).send({
        from: accounts[0],
        gasPrice: gasEstimator.getCurrentFastPrice()
      });
      logger.info({
        at: "Liquidator#index",
        message: "Approved EMP to transfer unlimited synthetic tokens 💰",
        syntheticApprovalTx: syntheticApprovalTx.transactionHash
      });
    }

    // Create a execution loop that will run indefinitely (or yield early if in serverless mode)
    while (true) {
      await retry(
        async () => {
          // Update the liquidators state. This will update the clients, price feeds and gas estimator.
          await liquidator.update();
          // Check for liquidatable positions and submit liquidations. Bounded by current synthetic balance and
          // considers override price if the user has specified one.
          const currentSyntheticBalance = await syntheticToken.methods.balanceOf(accounts[0]).call();
          await liquidator.liquidatePositions(currentSyntheticBalance, liquidatorOverridePrice);
          // Check for any finished liquidations that can be withdrawn.
          await liquidator.withdrawRewards();
        },
        {
          retries: errorRetries,
          minTimeout: errorRetriesTimeout * 1000, // delay between retries in ms
          randomize: false,
          onRetry: error => {
            logger.debug({
              at: "Liquidator#index",
              message: "An error was thrown in the execution loop - retrying",
              error: typeof error === "string" ? new Error(error) : error
            });
          }
        }
      );
      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        logger.debug({
          at: "Liquidator#index",
          message: "End of serverless execution loop - terminating process"
        });
        await waitForLogger(logger);
        break;
      }
      logger.debug({
        at: "Liquidator#index",
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
      // EMP Address. Should be an Ethereum address
      empAddress: process.env.EMP_ADDRESS,
      // One Split address. Should be an Ethereum address. Defaults to mainnet address 1split.eth
      oneSplitAddress: process.env.ONE_SPLIT_ADDRESS,
      // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
      pollingDelay: process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60,
      // Default to 3 re-tries on error within the execution loop.
      errorRetries: process.env.ERROR_RETRIES ? Number(process.env.ERROR_RETRIES) : 5,
      // Default to 10 seconds in between error re-tries.
      errorRetriesTimeout: process.env.ERROR_RETRIES_TIMEOUT ? Number(process.env.ERROR_RETRIES_TIMEOUT) : 10,
      // Read price feed configuration from an environment variable. This can be a crypto watch, medianizer or uniswap
      // price feed Config defines the exchanges to use. If not provided then the bot will try and infer a price feed
      // from the EMP_ADDRESS. EG with medianizer: {"type":"medianizer","pair":"ethbtc",
      // "lookback":7200, "minTimeBetweenUpdates":60,"medianizedFeeds":[{"type":"cryptowatch","exchange":"coinbase-pro"},
      // {"type":"cryptowatch","exchange":"binance"}]}
      priceFeedConfig: process.env.PRICE_FEED_CONFIG ? JSON.parse(process.env.PRICE_FEED_CONFIG) : null,
      // If there is a liquidator config, add it. Else, set to null. This config contains crThreshold,liquidationDeadline,
      // liquidationMinPrice, txnGasLimit & logOverrides. Example config:
      // {"crThreshold":0.02,  -> Liquidate if a positions collateral falls more than this % below the min CR requirement
      //   "liquidationDeadline":300, -> Aborts if the transaction is mined this amount of time after the last update
      //   "liquidationMinPrice":0, -> Aborts if the amount of collateral in the position per token is below this ratio
      //   "txnGasLimit":9000000 -> Gas limit to set for sending on-chain transactions.
      //   "logOverrides":{"positionLiquidated":"warn"}} -> override specific events log levels.
      liquidatorConfig: process.env.LIQUIDATOR_CONFIG ? JSON.parse(process.env.LIQUIDATOR_CONFIG) : null,
      // If there is a LIQUIDATOR_OVERRIDE_PRICE environment variable then the liquidator will disregard the price from the
      // price feed and preform liquidations at this override price. Use with caution as wrong input could cause invalid liquidations.
      liquidatorOverridePrice: process.env.LIQUIDATOR_OVERRIDE_PRICE
    };

    await run({ logger: Logger, web3: getWeb3(), ...executionParameters });
  } catch (error) {
    Logger.error({
      at: "Liquidator#index",
      message: "Liquidator execution error🚨",
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
