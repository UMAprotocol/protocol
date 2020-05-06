const argv = require("minimist")(process.argv.slice(), { string: ["address"], integer: ["price"] });
const { toWei } = web3.utils;

// Helpers.
const { delay } = require("../financial-templates-lib/helpers/delay");
const { Logger } = require("../financial-templates-lib/logger/Logger");

// Clients to retrieve on-chain data.
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { ExpiringMultiPartyEventClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyEventClient");
const { TokenBalanceClient } = require("../financial-templates-lib/clients/TokenBalanceClient");

// Monitor modules to report on client state changes.
const { ContractMonitor } = require("./ContractMonitor");
const { BalanceMonitor } = require("./BalanceMonitor");
const { CRMonitor } = require("./CRMonitor");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");

// TODO: Figure out a good way to run this script, maybe with a wrapper shell script.
// Currently, you can run it with `truffle exec ../monitor/index.js --price=<price>` *from the core  directory*.

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

  // 1. Contract state monitor
  const empEventClient = new ExpiringMultiPartyEventClient(Logger, ExpiringMultiParty.abi, web3, emp.address, 10);
  const contractMonitor = new ContractMonitor(Logger, empEventClient, [accounts[0]], [accounts[0]]);

  // 2. Balance monitor
  const collateralTokenAddress = await emp.collateralCurrency();
  const syntheticTokenAddress = await emp.tokenCurrency();

  const tokenBalanceClient = new TokenBalanceClient(
    Logger,
    ExpandedERC20.abi,
    web3,
    collateralTokenAddress,
    syntheticTokenAddress,
    10
  );

  // Bot objects to monitor. For each bot specify a name, address and the thresholds to monitor.
  // TODO: refactor this to pull state from env variables
  const botMonitorObject = [
    {
      name: "UMA liquidator Bot",
      address: "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D",
      collateralThreshold: toWei("10"),
      syntheticThreshold: toWei("10"),
      etherThreshold: toWei("10")
    }
  ];

  const balanceMonitor = new BalanceMonitor(Logger, tokenBalanceClient, botMonitorObject);
  // 3. Collateralization Ratio monitor
  // TODO: refactor this to dependency injection the logger like with the other monitors
  const empClient = new ExpiringMultiPartyClient(ExpiringMultiParty.abi, web3, emp.address, 10);

  // Wallet objects to monitor. For each wallet spesify a name,
  const walletMonitorObject = [
    {
      name: "Monitored sponsor wallet",
      address: accounts[2],
      crAlert: 150
    }
  ];

  const crMonitor = new CRMonitor(Logger, empClient, walletMonitorObject);

  while (true) {
    try {
      // 1.  Contract monitor
      // 1.a Update the client
      await empEventClient.update();
      // 1.b Check For new liquidation events
      await contractMonitor.checkForNewLiquidations(() => toWei(price.toString()));
      // 1.c Check for new disputes
      await contractMonitor.checkForNewDisputeEvents(() => toWei(price.toString()));
      // 1.d Check for new disputeSettlements
      await contractMonitor.checkForNewDisputeSettlementEvents(() => toWei(price.toString()));

      // 2.  Wallet Balance monitor
      // 2.a Update the client
      await tokenBalanceClient.update();
      // 2.b Check for monitored bot balance changes
      balanceMonitor.checkBotBalances();
      // 2.c Check for wallet threshold changes
      balanceMonitor.checkWalletCrRatio();

      // 3.  Position Collateralization Ratio monitor
      // 1.a Update the client
      await empClient.update();
      // 1.b Check for positions below their CR
      crMonitor.checkWalletCrRatio(() => toWei(price.toString()));

      console.log("After the point");
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
