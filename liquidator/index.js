const argv = require("minimist")(process.argv.slice(), { string: ["address"], integer: ["price"] });
const { toWei } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/delay");
const { Logger } = require("../financial-templates-lib/Logger");

// JS libs
const { Liquidator } = require("./Liquidator");
const { GasEstimator } = require("../financial-templates-lib/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/ExpiringMultiPartyClient");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// TODO: Figure out a good way to run this script, maybe with a wrapper shell script.
// Currently, you can run it with `truffle exec ../liquidator/liquidator.js --address=<address> --price=<price>` *from the core
// directory*.

async function run() {
  if (!argv.address) {
    console.log("Bad input arg! Specify an `address` for the location of the expiring Multi Party.");
    return;
  }
  // TODO: Remove this price flag once we have built the pricefeed module.
  if (!argv.price) {
    console.log("Bad input arg! Specify a `price` as the pricefeed.");
    return;
  }
  Logger.info({
    at: "liquidator#index",
    message: "liquidator started",
    empAddress: argv.address,
    currentPrice: argv.price
  });

  // Setup web3 accounts an contract instance
  const accounts = await web3.eth.getAccounts();
  const emp = await ExpiringMultiParty.at(argv.address);

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
      await liquidator.queryAndLiquidate(toWei(argv.price.toString()));
      await liquidator.queryAndWithdrawRewards();
    } catch (error) {
      Logger.error({
        at: "liquidator#index",
        message: "liquidator polling error",
        error: error
      });
    }
    await delay(Number(10_000));
  }
}

module.exports = async function(callback) {
  try {
    await run();
  } catch (err) {
    console.error(err);
    callback(err);
  }
  callback();
};
