const argv = require("minimist")(process.argv.slice(), { string: ["address"] });

const { ExpiringMultiPartyClient } = require("../financial-templates-lib/ExpiringMultiPartyClient.js");
const { delay } = require("../financial-templates-lib/delay.js");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

// TODO: Figure out a good way to run this script, maybe with a wrapper shell script.
// Currently, you can run it with `truffle exec ../liquidator/liquidator.js --address=<address>` *from the core
// directory*.
async function run() {
  const client = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, argv.address);
  client.start();
  while (true) {
    try {
      console.log("Polling");
      // Steps:
      // Get most recent price from a price feed.
      // Call client.getUnderCollateralizedPositions()
      // Acquire synthetic tokens somehow. v0: assume the bot holds on to them.
      // Liquidate any undercollateralized positions!
      // Withdraw money from any liquidations that are expired or DisputeFailed.
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
    callback(err);
  }
  callback();
};
