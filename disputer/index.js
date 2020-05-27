require("dotenv").config();
const { toBN } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/helpers/delay");
const { Logger, waitForLogger } = require("../financial-templates-lib/logger/Logger");
const { MAX_UINT_VAL } = require("../common/Constants");

// JS libs
const { Disputer } = require("./disputer");
const { GasEstimator } = require("../financial-templates-lib/helpers/GasEstimator");
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { createPriceFeed } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../financial-templates-lib/price-feed/Networker");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");

/**
 * @notice Continuously attempts to dispute liquidations in the EMP contract.
 * @param {String} address Contract address of the EMP.
 * @param {bool} shouldPoll whether to poll continuously or run a single iteration (for testing).
 * @param {Number} pollingDelay number of seconds to delay between polls.
 * @param {Object} priceFeedConfig configuration to construct the price feed object.
 * @return None or throws an Error.
 */
async function run(address, shouldPoll, pollingDelay, priceFeedConfig) {
  try {
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
    // TODO: consider making getTime async and using contract time.
    const getTime = () => Math.round(new Date().getTime() / 1000);
    const priceFeed = await createPriceFeed(Logger, web3, new Networker(Logger), getTime, priceFeedConfig);

    if (!priceFeed) {
      throw "Price feed config is invalid";
    }

    // Client and dispute bot
    const empClient = new ExpiringMultiPartyClient(Logger, ExpiringMultiParty.abi, web3, emp.address);
    const gasEstimator = new GasEstimator(Logger);
    const disputer = new Disputer(Logger, empClient, gasEstimator, priceFeed, accounts[0]);

    // The EMP requires approval to transfer the disputer's collateral tokens in order to dispute
    // a liquidation. We'll set this once to the max value and top up whenever the bot's allowance drops below
    // MAX_INT / 2.
    const collateralToken = await ExpandedERC20.at(await emp.collateralCurrency());
    const currentAllowance = await collateralToken.allowance(accounts[0], empClient.empAddress);
    if (toBN(currentAllowance).lt(toBN(MAX_UINT_VAL).div(toBN("2")))) {
      const collateralApprovalTx = await collateralToken.approve(empClient.empAddress, MAX_UINT_VAL, {
        from: accounts[0]
      });
      Logger.info({
        at: "Disputer#index",
        message: "Approved EMP to transfer unlimited collateral tokens",
        collateralApprovalTx: collateralApprovalTx.transactionHash
      });
    }

    while (true) {
      await disputer.queryAndDispute();
      await disputer.queryAndWithdrawRewards();

      await delay(Number(pollingDelay));

      if (!shouldPoll) {
        break;
      }
    }
  } catch (error) {
    Logger.error({
      at: "Disputer#index🚨",
      message: "Disputer error",
      error: new Error(error)
    });
    await waitForLogger(Logger);
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
      at: "Disputer#index🚨",
      message: "Disputer configuration error",
      error: new Error(error)
    });
    await waitForLogger(Logger);
    callback(error);
    return;
  }
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
