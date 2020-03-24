const argv = require("minimist")(process.argv.slice(), { string: ["address", "price"] });
const { toWei } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/delay");
const { Logger } = require("../financial-templates-lib/Logger");

// JS libs
const { Disputer } = require("./disputer");
const { GasEstimator } = require("../financial-templates-lib/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/ExpiringMultiPartyClient");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

/**
 * @notice Continuously attempts to dispute liquidations in the EMP contract.
 * @param {Number} price Price used to determine which liquidations to dispute.
 * @param {String} address Contract address of the EMP.
 * @return None or throws an Error.
 */
async function run(price, address, shouldPoll) {
  Logger.info({
    at: "Disputer#index",
    message: "Disputer started",
    empAddress: argv.address,
    currentPrice: argv.price
  });

  // Setup web3 accounts an contract instance
  const accounts = await web3.eth.getAccounts();
  const emp = await ExpiringMultiParty.at(address);

  // Client and dispute bot
  const empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);
  const gasEstimator = new GasEstimator();
  const disputer = new Disputer(empClient, gasEstimator, accounts[0]);

  while (true) {
    try {
      await disputer.queryAndDispute(() => toWei(price));
      await disputer.queryAndWithdrawRewards();
    } catch (error) {
      Logger.error({
        at: "Disputer#index",
        message: "Disputer error",
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
    console.error(err);
    callback(err);
  }
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
