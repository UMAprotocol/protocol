require("dotenv").config();
const { toWei } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/helpers/delay");
const { Logger } = require("../financial-templates-lib/logger/Logger");

// JS libs
const { Disputer } = require("./disputer");
const { GasEstimator } = require("../financial-templates-lib/helpers/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { createPriceFeed } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../financial-templates-lib/price-feed/Networker");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

/**
 * @notice Continuously attempts to dispute liquidations in the EMP contract.
 * @param {String} address Contract address of the EMP.
 * @param {bool} shouldPoll whether to poll continuously or run a single iteration (for testing).
 * @param {Number} pollingDelay number of seconds to delay between polls.
 * @param {Object} priceFeedConfig configuration to construct the price feed object.
 * @return None or throws an Error.
 */
async function run(address, shouldPoll, pollingDelay, priceFeedConfig) {
  Logger.info({
    at: "Disputer#index",
    message: "Disputer started🔎",
    empAddress: address,
    pollingDelay: pollingDelay,
    priceFeedConfig
  });

  // Setup web3 accounts an contract instance
  const accounts = await web3.eth.getAccounts();
  const emp = await ExpiringMultiParty.at(address);

  // Setup price feed.
  const getTime = () => Math.round(new Date().getTime() / 1000);
  const priceFeed = await createPriceFeed(web3, Logger, new Networker(Logger), getTime, priceFeedConfig);

  if (!priceFeed) {
    throw "Price feed config is invalid";
  }

  // Client and dispute bot
  const empClient = new ExpiringMultiPartyClient(Logger, ExpiringMultiParty.abi, web3, emp.address);
  const gasEstimator = new GasEstimator(Logger, getTime);
  const disputer = new Disputer(Logger, empClient, gasEstimator, priceFeed, accounts[0]);

  while (true) {
    try {
      await disputer.queryAndDispute();
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

    const pollingDelay = process.env.POLLING_DELAY ? process.env.POLLING_DELAY : 10_000;
    const priceFeedConfig = JSON.parse(process.env.PRICE_FEED_CONFIG);

    await run(process.env.EMP_ADDRESS, true, pollingDelay, priceFeedConfig);
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
