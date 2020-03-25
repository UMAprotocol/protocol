const argv = require("minimist")(process.argv.slice(), { string: ["address", "price"] });
const { toWei, hexToUtf8, toBN } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/delay");
const { Logger } = require("../financial-templates-lib/logger/Logger");

// JS libs
const { Disputer } = require("./Disputer");
const { GasEstimator } = require("../financial-templates-lib/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/ExpiringMultiPartyClient");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

async function run() {
  if (!argv.address || !argv.price) {
    throw "Must provide --address and --price arguments";
  }
  Logger.info({
    at: "Disputer#index",
    message: "Disputer started",
    empAddress: argv.address,
    currentPrice: argv.price
  });

  // Setup web3 accounts an contract instance
  const accounts = await web3.eth.getAccounts();
  const emp = await ExpiringMultiParty.at(argv.address);

  // Client and dispute bot
  const empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address);
  const gasEstimator = new GasEstimator();
  const disputer = new Disputer(empClient, gasEstimator, accounts[0]);

  while (true) {
    try {
      await disputer.queryAndDispute(() => toWei(argv.price));
      await disputer.queryAndWithdrawRewards();
    } catch (error) {
      Logger.error({
        at: "Disputer#index",
        message: "Disputer error",
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
