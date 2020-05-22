require("dotenv").config();

// Helpers
const { delay } = require("../financial-templates-lib/helpers/delay");
const { startServer } = require("../common/ServerUtils");
const { Logger, waitForLogger } = require("../financial-templates-lib/logger/Logger");
const { MAX_UINT_VAL } = require("../common/Constants");
const { toBN } = web3.utils;

// JS libs
const { Liquidator } = require("./liquidator");
const { GasEstimator } = require("../financial-templates-lib/helpers/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { createPriceFeed } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../financial-templates-lib/price-feed/Networker");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");

// TODO: Figure out a good way to run this script, maybe with a wrapper shell script.
// Currently, you can run it with `truffle exec ../liquidator/index.js --address=<address> --price=<price>` *from the core
// directory*.

/**
 * @notice Continuously attempts to liquidate positions in the EMP contract.å
 * @param {Number} price Price used to determine undercollateralized positions to liquidate.
 * @param {String} address Contract address of the EMP.
 * @param {Boolean} shouldPoll If False, then exit after one iteration. Used for testing.
 * @param {Number} pollingDelay The amount of milliseconds to wait between iterations.
 * @param {Number} [monitorPort] Monitor server port number.
 * @return None or throws an Error.
 */
async function run(address, shouldPoll, pollingDelay, priceFeedConfig, monitorPort) {
  try {
    Logger.info({
      at: "liquidator#index",
      message: "liquidator started 🕵️‍♂️",
      empAddress: address,
      pollingDelay: pollingDelay,
      priceFeedConfig,
      monitorPort
    });

    // Setup web3 accounts an contract instance
    const accounts = await web3.eth.getAccounts();
    const emp = await ExpiringMultiParty.at(address);

    // Setup price feed.
    // TODO: consider making getTime async and using contract time.
    const getTime = () => Math.round(new Date().getTime() / 1000);
    const priceFeed = await createPriceFeed(Logger, web3, new Networker(Logger), getTime, priceFeedConfig);

    if (!priceFeed) {
      throw "Price feed config is invalid";
    }

    // Client and liquidator bot
    const empClient = new ExpiringMultiPartyClient(Logger, ExpiringMultiParty.abi, web3, emp.address);
    const gasEstimator = new GasEstimator(Logger);
    const liquidator = new Liquidator(Logger, empClient, gasEstimator, priceFeed, accounts[0]);

    // The EMP requires approval to transfer the liquidator's collateral and synthetic tokens in order to liquidate
    // a position. We'll set this once to the max value and top up whenever the bot's allowance drops below
    // MAX_INT / 2.
    const collateralToken = await ExpandedERC20.at(await emp.collateralCurrency());
    const syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());
    const currentCollateralAllowance = await collateralToken.allowance(accounts[0], empClient.empAddress);
    const currentSyntheticAllowance = await syntheticToken.allowance(accounts[0], empClient.empAddress);
    if (toBN(currentCollateralAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      const collateralApprovalTx = await collateralToken.approve(empClient.empAddress, MAX_UINT_VAL, {
        from: accounts[0]
      });
      Logger.debug({
        at: "liquidator#index",
        message: "Approved EMP to transfer unlimited collateral tokens",
        collateralApprovalTx: collateralApprovalTx.transactionHash
      });
    }
    if (toBN(currentSyntheticAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      const syntheticApprovalTx = await syntheticToken.approve(empClient.empAddress, MAX_UINT_VAL, {
        from: accounts[0]
      });
      Logger.debug({
        at: "liquidator#index",
        message: "Approved EMP to transfer unlimited synthetic tokens",
        collateralApprovalTx: syntheticApprovalTx.transactionHash
      });
    }

    // Start monitoring server, which should listen for incoming requests as long as this bot is alive.
    const { server, portNumber } = startServer(monitorPort);
    Logger.debug({
      at: "liquidator#index",
      message: "Monitor server is listening",
      portNumber: portNumber
    });

    while (true) {
      // Steps:
      // Get most recent price from a price feed.
      // Call client.getUnderCollateralizedPositions()
      // Acquire synthetic tokens somehow. v0: assume the bot holds on to them.
      // Liquidate any undercollateralized positions!
      // Withdraw money from any liquidations that are expired or DisputeFailed.
      await liquidator.queryAndLiquidate();
      await liquidator.queryAndWithdrawRewards();

      await delay(Number(pollingDelay));

      if (!shouldPoll) {
        break;
      }
    }

    // TODO: I'm not sure if this actually is working as expected.
    // Close server gracefully.
    server.close();
  } catch (error) {
    console.log(error);
    Logger.error({
      at: "Liquidator#index",
      message: "Liquidator polling error🚨",
      error: error.toString()
    });
    await waitForLogger(Logger);
  }
}

const Poll = async function(callback) {
  try {
    if (!process.env.EMP_ADDRESS) {
      throw "Bad input arg! Specify an `EMP_ADDRESS` for the location of the expiring Multi Party within your environment variables.";
    }

    const pollingDelay = process.env.POLLING_DELAY ? process.env.POLLING_DELAY : 10000;

    if (!process.env.PRICE_FEED_CONFIG) {
      throw "Bad input arg! Specify an `PRICE_FEED_CONFIG` for the location of the expiring Multi Party within your environment variables.";
    }

    const priceFeedConfig = JSON.parse(process.env.PRICE_FEED_CONFIG);

    const portNumber = 8888;

    await run(process.env.EMP_ADDRESS, true, pollingDelay, priceFeedConfig, portNumber);
  } catch (error) {
    Logger.error({
      at: "Liquidator#index",
      message: "Liquidator configuration error🚨",
      error: error.toString()
    });
    await waitForLogger(Logger);
    callback(error);
    return;
  }
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
