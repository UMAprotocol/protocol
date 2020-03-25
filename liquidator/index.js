const argv = require("minimist")(process.argv.slice(), { string: ["address"], integer: ["price"] });
const { toWei } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/delay");
const { Logger } = require("../financial-templates-lib/logger/Logger");

// JS libs
const { Liquidator } = require("./liquidator");
const { GasEstimator } = require("../financial-templates-lib/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/ExpiringMultiPartyClient");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// TODO: Figure out a good way to run this script, maybe with a wrapper shell script.
// Currently, you can run it with `truffle exec ../liquidator/index.js --address=<address> --price=<price>` *from the core
// directory*.

/**
 * @notice Continuously attempts to liquidate positions in the EMP contract.å
 * @param {Number} price Price used to determine undercollateralized positions to liquidate.
 * @param {String} address Contract address of the EMP.
 * @return None or throws an Error.
 */
async function run(price, address, shouldPoll) {
  Logger.info({
    at: "liquidator#index",
    message: "liquidator started 🕵️‍♂️",
    empAddress: address,
    currentPrice: price
  });

  // Setup web3 accounts an contract instance
  const accounts = await web3.eth.getAccounts();
  const emp = await ExpiringMultiParty.at(address);

  // Client and liquidator bot
  const empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);
  const gasEstimator = new GasEstimator();
  const liquidator = new Liquidator(empClient, gasEstimator, accounts[0]);

  while (true) {
    try {
      // Steps:
      // Get most recent price from a price feed.
      // Call client.getUnderCollateralizedPositions()
      // Acquire synthetic tokens somehow. v0: assume the bot holds on to them.
      // Liquidate any undercollateralized positions!
      // Withdraw money from any liquidations that are expired or DisputeFailed.
      await liquidator.queryAndLiquidate(toWei(price.toString()));
      await liquidator.queryAndWithdrawRewards();
    } catch (error) {
      Logger.error({
        at: "liquidator#index",
        message: "liquidator polling error",
        error: error
      });
    }
    await delay(Number(10_000));

    if (!shouldPoll) {
      break;
    }
  }
}

const Poll = async function(callback) {
  try {
    if (!argv.address) {
      throw new Error("Bad input arg! Specify an `address` for the location of the expiring Multi Party.");
    }
    // TODO: Remove this price flag once we have built the pricefeed module.
    if (!argv.price) {
      throw new Error("Bad input arg! Specify a `price` as the pricefeed.");
    }

    await run(argv.price, argv.address, true);
  } catch (err) {
    callback(err);
  }
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
