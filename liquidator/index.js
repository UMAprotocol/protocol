require("dotenv").config();

// Helpers
const { MAX_UINT_VAL } = require("@umaprotocol/common");
const { toBN } = web3.utils;

// JS libs
const { Liquidator } = require("./liquidator");
const {
  GasEstimator,
  ExpiringMultiPartyClient,
  Networker,
  Logger,
  createReferencePriceFeedForEmp,
  waitForLogger,
  delay
} = require("@umaprotocol/financial-templates-lib");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const Voting = artifacts.require("Voting");

/**
 * @notice Continuously attempts to liquidate positions in the EMP contract.
 * @param {Object} logger Module responsible for sending logs.
 * @param {String} address Contract address of the EMP.
 * @param {Number} pollingDelay The amount of seconds to wait between iterations. If set to 0 then running in serverless
 *     mode which will exit after the loop.
 * @param {Object} priceFeedConfig Configuration to construct the price feed object.
 * @param {Object} [liquidatorConfig] Configuration to construct the liquidator.
 * @param {String} [liquidatorOverridePrice] Optional String representing a Wei number to override the liquidator price feed.
 * @return None or throws an Error.
 */
async function run(logger, address, pollingDelay, priceFeedConfig, liquidatorConfig, liquidatorOverridePrice) {
  try {
    // If pollingDelay === 0 then the bot is running in serverless mode and should send a `debug` level log.
    // Else, if running in loop mode (pollingDelay != 0), then it should send a `info` level log.
    logger[pollingDelay === 0 ? "debug" : "info"]({
      at: "Liquidator#index",
      message: "Liquidator started 🌊",
      empAddress: address,
      pollingDelay,
      priceFeedConfig,
      liquidatorConfig,
      liquidatorOverridePrice
    });

    // Setup web3 accounts an contract instance.
    const accounts = await web3.eth.getAccounts();
    const emp = await ExpiringMultiParty.at(address);
    const voting = await Voting.deployed();

    // Generate EMP properties to inform bot of important on-chain state values that we only want to query once.
    const empProps = {
      crRatio: await emp.collateralRequirement(),
      priceIdentifier: await emp.priceIdentifier(),
      minSponsorSize: await emp.minSponsorTokens()
    };

    // Setup price feed.
    const getTime = () => Math.round(new Date().getTime() / 1000);

    const priceFeed = await createReferencePriceFeedForEmp(
      logger,
      web3,
      new Networker(logger),
      getTime,
      address,
      priceFeedConfig
    );

    if (!priceFeed) {
      throw new Error("Price feed config is invalid");
    }

    // Client and liquidator bot
    const empClient = new ExpiringMultiPartyClient(logger, ExpiringMultiParty.abi, web3, emp.address);
    const gasEstimator = new GasEstimator(logger);
    const liquidator = new Liquidator(
      logger,
      empClient,
      voting,
      gasEstimator,
      priceFeed,
      accounts[0],
      empProps,
      liquidatorConfig
    );

    // The EMP requires approval to transfer the liquidator's collateral and synthetic tokens in order to liquidate
    // a position. We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
    await gasEstimator.update();
    const collateralToken = await ExpandedERC20.at(await emp.collateralCurrency());
    const syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());
    const currentCollateralAllowance = await collateralToken.allowance(accounts[0], empClient.empAddress);
    const currentSyntheticAllowance = await syntheticToken.allowance(accounts[0], empClient.empAddress);
    if (toBN(currentCollateralAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      // const collateralApprovalTx = await collateralToken.approve(empClient.empAddress, MAX_UINT_VAL, {
      //   from: accounts[0],
      //   gasPrice: gasEstimator.getCurrentFastPrice()
      // });
      // logger.info({
      //   at: "Liquidator#index",
      //   message: "Approved EMP to transfer unlimited collateral tokens 💰",
      //   collateralApprovalTx: collateralApprovalTx.tx
      // });
    }
    if (toBN(currentSyntheticAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      // const syntheticApprovalTx = await syntheticToken.approve(empClient.empAddress, MAX_UINT_VAL, {
      //   from: accounts[0],
      //   gasPrice: gasEstimator.getCurrentFastPrice()
      // });
      // logger.info({
      //   at: "Liquidator#index",
      //   message: "Approved EMP to transfer unlimited synthetic tokens 💰",
      //   collateralApprovalTx: syntheticApprovalTx.tx
      // });
    }

    while (true) {
      const currentSyntheticBalance = await syntheticToken.balanceOf(accounts[0]);
      await liquidator.update();
      await liquidator.liquidatePositions(currentSyntheticBalance, liquidatorOverridePrice);
      await liquidator.queryAndWithdrawRewards();

      // If the polling delay is set to 0 then the script will terminate the bot after one full run.
      if (pollingDelay === 0) {
        await waitForLogger(logger);
        break;
      }
      await delay(Number(pollingDelay));
    }
  } catch (error) {
    logger.error({
      at: "Liquidator#index",
      message: "Liquidator polling error🚨",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(logger);
  }
}

async function Poll(callback) {
  try {
    if (!process.env.EMP_ADDRESS) {
      throw new Error(
        "Bad input arg! Specify an `EMP_ADDRESS` for the location of the expiring Multi Party within your environment variables."
      );
    }

    // Default to 1 minute delay. If set to 0 in env variables then the script will exit after full execution.
    const pollingDelay = process.env.POLLING_DELAY ? Number(process.env.POLLING_DELAY) : 60;

    // Read price feed configuration from an environment variable. This can be a crypto watch, medianizer or uniswap
    // price feed Config defines the exchanges to use. If not provided then the bot will try and infer a price feed
    // from the EMP_ADDRESS. EG with medianizer: {"type":"medianizer","pair":"ethbtc",
    // "lookback":7200, "minTimeBetweenUpdates":60,"medianizedFeeds":[{"type":"cryptowatch","exchange":"coinbase-pro"},
    // {"type":"cryptowatch","exchange":"binance"}]}
    const priceFeedConfig = process.env.PRICE_FEED_CONFIG ? JSON.parse(process.env.PRICE_FEED_CONFIG) : null;

    // If there is a disputer config, add it. Else, set to null. This config contains crThreshold,liquidationDeadline,
    // liquidationMinPrice, txnGasLimit & logOverrides. Example config:
    // {"crThreshold":0.02,  -> Liquidate if a positions collateral falls more than this % below the min CR requirement
    //   "liquidationDeadline":300, -> Aborts if the transaction is mined this amount of time after the last update
    //   "liquidationMinPrice":0, -> Aborts if the amount of collateral in the position per token is below this ratio
    //   "txnGasLimit":9000000 -> Gas limit to set for sending on-chain transactions.
    //   "logOverrides":{"positionLiquidated":"warn"}} -> override specific events log levels.
    const liquidatorConfig = process.env.LIQUIDATOR_CONFIG ? JSON.parse(process.env.LIQUIDATOR_CONFIG) : null;

    // If there is a LIQUIDATOR_OVERRIDE_PRICE environment variable then the liquidator will disregard the price from the
    // price feed and preform liquidations at this override price. Use with caution as wrong input could cause invalid liquidations.
    const liquidatorOverridePrice = process.env.LIQUIDATOR_OVERRIDE_PRICE;

    await run(
      Logger,
      process.env.EMP_ADDRESS,
      pollingDelay,
      priceFeedConfig,
      liquidatorConfig,
      liquidatorOverridePrice
    );
  } catch (error) {
    Logger.error({
      at: "Liquidator#index",
      message: "Liquidator configuration error🚨",
      error: typeof error === "string" ? new Error(error) : error
    });
    await waitForLogger(Logger);
    callback(error);
    return;
  }
  callback();
}

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
