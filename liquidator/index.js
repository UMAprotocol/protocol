const argv = require("minimist")(process.argv.slice(), { string: ["address"] });
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
  console.log("Starting liquidator bot! Running against expiring multi party contract at address", argv.address);

  console.log("accounts");
  const accounts = await web3.eth.getAccounts();
  const emp = await ExpiringMultiParty.at(argv.address);

  let empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);
  let liquidator = new Liquidator(empClient, accounts[0]);
  await liquidator.queryAndLiquidate(toWei("1.3"));

  // while (true) {
  //   try {
  //     console.log("Polling");
  //     // Steps:
  //     // Get most recent price from a price feed.
  //     // Call client.getUnderCollateralizedPositions()
  //     // Acquire synthetic tokens somehow. v0: assume the bot holds on to them.
  //     // Liquidate any undercollateralized positions!
  //     // Withdraw money from any liquidations that are expired or DisputeFailed.
  //     liquidator.queryAndLiquidate(1.3);
  //   } catch (error) {
  //     console.log("Poll error:", error);
  //   }
  //   await delay(Number(10_000));
  // }
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
