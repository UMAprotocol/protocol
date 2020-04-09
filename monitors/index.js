const argv = require("minimist")(process.argv.slice(), { string: ["address"], integer: ["price"] });
const { toWei } = web3.utils;

// Helpers
const { delay } = require("../financial-templates-lib/delay");
const { Logger } = require("../financial-templates-lib/logger/Logger");

// JS libs
const { ContractMonitor } = require("./ContractMonitor");
const { BalanceMonitor } = require("./BalanceMonitor");

const { ExpiringMultiPartyEventClient } = require("../financial-templates-lib/ExpiringMultiPartyEventClient");
const { TokenBalanceClient } = require("../financial-templates-lib/TokenBalanceClient");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");

// TODO: Figure out a good way to run this script, maybe with a wrapper shell script.
// Currently, you can run it with `truffle exec ../liquidator/index.js --address=<address> --price=<price>` *from the core
// directory*.

/**
 * @notice Continuously attempts to monitor contract positions listening for newly emmited events.
 * @param {Number} price Price used to inform the collateralization ratio of positions.
 * @param {String} address Contract address of the EMP.
 * @return None or throws an Error.
 */
async function run(price, address, shouldPoll) {
  Logger.info({
    at: "Monitor#index",
    message: "Monitor started 🕵️‍♂️",
    empAddress: address,
    currentPrice: price
  });

  // Setup web3 accounts an contract instance
  const accounts = await web3.eth.getAccounts();
  const emp = await ExpiringMultiParty.at(address);

  // Client and liquidator bot
  const empEventClient = new ExpiringMultiPartyEventClient(ExpiringMultiParty.abi, web3, emp.address, 10);

  const contractMonitor = new ContractMonitor(empEventClient, accounts[0], accounts[0]);

  const collateralTokenAddress = await emp.collateralCurrency();
  const syntheticTokenAddress = await emp.tokenCurrency();

  const tokenBalanceClient = new TokenBalanceClient(
    ExpandedERC20.abi,
    web3,
    collateralTokenAddress,
    syntheticTokenAddress,
    10
  );

  const botMonitorObject = [
    {
      name: "test liquidator Bot",
      address: accounts[1],
      collateralThreshold: toWei("10000000"),
      syntheticThreshold: toWei("10000000"),
      etherThreshold: toWei("10000000")
    }
  ];

  const walletMonitorObject = [
    {
      walletName: "UMA sponsor wallet",
      address: accounts[2],
      crAlert: 150
    }
  ];

  const balanceMonitor = new BalanceMonitor(tokenBalanceClient, accounts[0], botMonitorObject, walletMonitorObject);

  while (true) {
    try {
      ///: contractMonitor
      // Steps:
      // 1. Update the client
      // 2. Check For new liquidation events
      // 3. Check for new disputes
      // 4. Check for new disputeSettlements
      // await empEventClient._update();
      // await contractMonitor.checkForNewLiquidations(toWei(price.toString()));
      // await contractMonitor.checkForNewDisputeEvents(toWei(price.toString()));
      // await contractMonitor.checkForNewDisputeSettlementEvents(toWei(price.toString()));

      await tokenBalanceClient._update();

      ///: balanceMonitor
      balanceMonitor.checkBotBalances();
    } catch (error) {
      Logger.error({
        at: "Monitors#index",
        message: "Monitor polling error",
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
