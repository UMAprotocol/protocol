require("dotenv").config();
const { toWei } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/helpers/delay");
const { Logger } = require("../financial-templates-lib/logger/Logger");

// JS libs
const { Liquidator } = require("./liquidator");
const { GasEstimator } = require("../financial-templates-lib/helpers/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { createPriceFeed } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../financial-templates-lib/price-feed/Networker");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// TODO: Figure out a good way to run this script, maybe with a wrapper shell script.
// Currently, you can run it with `truffle exec ../liquidator/index.js --address=<address> --price=<price>` *from the core
// directory*.

/**
 * @notice Continuously attempts to liquidate positions in the EMP contract.å
 * @param {Number} price Price used to determine undercollateralized positions to liquidate.
 * @param {String} address Contract address of the EMP.
 * @param {Boolean} shouldPoll If False, then exit after one iteration. Used for testing.
 * @param {Number} pollingDelay The amount of milliseconds to wait between iterations.
 * @return None or throws an Error.
 */
async function run(address, shouldPoll, pollingDelay, priceFeedConfig) {
  try {
    Logger.info({
      at: "liquidator#index",
      message: "liquidator started 🕵️‍♂️",
      empAddress: address,
      pollingDelay: pollingDelay
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
  } catch (error) {
    Logger.error({
      at: "Liquidator#index",
      message: "Liquidator polling error🚨",
      error: error.toString()
    });
    await delay(5000); // Hacky fix to ensure that winston still fires messages upstream.
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

    await run(process.env.EMP_ADDRESS, true, pollingDelay, priceFeedConfig);
  } catch (error) {
    Logger.error({
      at: "Liquidator#index",
      message: "Liquidator configuration error🚨",
      error: error.toString()
    });
    await delay(5000); // Hacky fix to ensure that winston still fires messages upstream.
    callback(error);
  }
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
