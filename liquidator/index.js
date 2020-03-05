const argv = require("minimist")(process.argv.slice(), { string: ["address"], integer: ["price"] });
const { toWei, hexToUtf8, toBN } = web3.utils;

const { delay } = require("../financial-templates-lib/delay");

// JS libs
const { Liquidator } = require("./Liquidator.js");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/ExpiringMultiPartyClient.js");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// TODO: Figure out a good way to run this script, maybe with a wrapper shell script.
// Currently, you can run it with `truffle exec ../liquidator/liquidator.js --address=<address>` *from the core
// directory*.

async function run() {
  if (!argv.address) {
    console.log("Bad input arg! Specify an `address` for the location of the expiring Multi Party.");
    return;
  }
  console.log("Starting liquidator bot!\nRunning on expiring multi party contract @", argv.address);
  
  // Setup web3 accounts an contract instance
  const accounts = await web3.eth.getAccounts();
  const emp = await ExpiringMultiParty.at(argv.address);

  // Client and liquidator bot
  let empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);
  let liquidator = new Liquidator(empClient, accounts[0]);

  while (true) {
    try {
      // Steps:
      // Get most recent price from a price feed.
      // Call client.getUnderCollateralizedPositions()
      // Acquire synthetic tokens somehow. v0: assume the bot holds on to them.
      // Liquidate any undercollateralized positions!
      // Withdraw money from any liquidations that are expired or DisputeFailed.

      console.log("Executing Liquidator");
      await liquidator.queryAndLiquidate(toWei(argv.price.toString()));
    } catch (error) {
      console.log("Poll error:", error);
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
