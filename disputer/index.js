require("dotenv").config();
const { toWei } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/helpers/delay");
const { Logger } = require("../financial-templates-lib/logger/Logger");

// JS libs
const { Disputer } = require("./disputer");
const { GasEstimator } = require("../financial-templates-lib/helpers/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

/**
 * @notice Continuously attempts to dispute liquidations in the EMP contract.
 * @param {Number} price Price used to determine which liquidations to dispute.
 * @param {String} address Contract address of the EMP.
 * @return None or throws an Error.
 */
async function run(price, address, shouldPoll, pollingDelay) {
  Logger.info({
    at: "Disputer#index",
    message: "Disputer started🔎",
    empAddress: address,
    currentPrice: price,
    pollingDelay: pollingDelay
  });

  // Setup web3 accounts an contract instance
  const accounts = await web3.eth.getAccounts();
  const emp = await ExpiringMultiParty.at(address);

  // Client and dispute bot
  const empClient = new ExpiringMultiPartyClient(Logger, ExpiringMultiParty.abi, web3, emp.address);
  const gasEstimator = new GasEstimator(Logger);
  const disputer = new Disputer(Logger, empClient, gasEstimator, accounts[0]);

  while (true) {
    try {
      await disputer.queryAndDispute(() => toWei(price));
      await disputer.queryAndWithdrawRewards();
    } catch (error) {
      Logger.error({
        at: "Disputer#index🚨",
        message: "Disputer error",
        error: error
      });
    }
    await delay(Number(pollingDelay));

    if (!shouldPoll) {
      break;
    }
  }
}

const Poll = async function(callback) {
  try {
    if (!process.env.EMP_ADDRESS) {
      throw new Error(
        "Bad input arg! Specify an `EMP_ADDRESS ` for the location of the expiring Multi Party within your enviroment variables."
      );
    }
    // TODO: Remove this price flag once we have built the pricefeed module.
    if (!process.env.PRICE) {
      throw new Error("Bad input arg! Specify a `price` as the pricefeed.");
    }

    let pollingDelay = 10_000; // default to 10 seconds, else use env value
    if (!process.env.POLLING_DELAY) {
      pollingDelay = process.env.POLLING_DELAY;
    }

    await run(process.env.PRICE, process.env.EMP_ADDRESS, true, pollingDelay);
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
