require("dotenv").config();
const { toWei } = web3.utils;

// Helpers.
const { delay } = require("../financial-templates-lib/helpers/delay");
const { Logger, waitForLogger } = require("../financial-templates-lib/logger/Logger");
const { createPriceFeed } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../financial-templates-lib/price-feed/Networker");

// Clients to retrieve on-chain data.
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { ExpiringMultiPartyEventClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyEventClient");
const { TokenBalanceClient } = require("../financial-templates-lib/clients/TokenBalanceClient");

// Monitor modules to report on client state changes.
const { ContractMonitor } = require("./ContractMonitor");
const { BalanceMonitor } = require("./BalanceMonitor");
const { CRMonitor } = require("./CRMonitor");
const { SyntheticPegMonitor } = require("./SyntheticPegMonitor");

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
async function run(
  address,
  shouldPoll,
  botMonitorObject,
  walletMonitorObject,
  syntheticPegMonitorObject,
  pollingDelay,
  uniswapPriceFeedConfig,
  medianizerPriceFeedConfig
) {
  try {
    Logger.info({
      at: "Monitor#index",
      message: "Monitor started 🕵️‍♂️",
      empAddress: address,
      pollingDelay: pollingDelay,
      botMonitorObject,
      walletMonitorObject,
      syntheticPegMonitorObject,
      uniswapPriceFeedConfig,
      medianizerPriceFeedConfig
    });

    // Setup web3 accounts an contract instance
    const accounts = await web3.eth.getAccounts();
    const emp = await ExpiringMultiParty.at(address);

    // Setup price feed.
    // TODO: consider making getTime async and using contract time.
    const getTime = () => Math.round(new Date().getTime() / 1000);
    const medianizerPriceFeed = await createPriceFeed(
      Logger,
      web3,
      new Networker(Logger),
      getTime,
      medianizerPriceFeedConfig
    );

    // 1. Contract state monitor
    const empEventClient = new ExpiringMultiPartyEventClient(Logger, ExpiringMultiParty.abi, web3, emp.address, 10);
    const contractMonitor = new ContractMonitor(
      Logger,
      empEventClient,
      [accounts[0]],
      [accounts[0]],
      medianizerPriceFeed
    );

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

    const balanceMonitor = new BalanceMonitor(Logger, tokenBalanceClient, botMonitorObject);

    // 3. Collateralization Ratio monitor.
    const empClient = new ExpiringMultiPartyClient(Logger, ExpiringMultiParty.abi, web3, emp.address, 10);

    const crMonitor = new CRMonitor(Logger, empClient, walletMonitorObject, medianizerPriceFeed);

    // 4. Synthetic Peg Monitor.
    const uniswapPriceFeed = await createPriceFeed(
      Logger,
      web3,
      new Networker(Logger),
      getTime,
      uniswapPriceFeedConfig
    );
    const syntheticPegMonitor = new SyntheticPegMonitor(
      Logger,
      web3,
      uniswapPriceFeed,
      medianizerPriceFeed,
      syntheticPegMonitorObject
    );

    while (true) {
      // 1.  Contract monitor
      // 1.a Update the client
      await empEventClient.update();
      await medianizerPriceFeed.update();
      // 1.b Check For new liquidation events
      await contractMonitor.checkForNewLiquidations();
      // 1.c Check for new disputes
      await contractMonitor.checkForNewDisputeEvents();
      // 1.d Check for new disputeSettlements
      await contractMonitor.checkForNewDisputeSettlementEvents();

      // 2.  Wallet Balance monitor
      // 2.a Update the client
      await tokenBalanceClient.update();
      // 2.b Check for monitored bot balance changes
      await balanceMonitor.checkBotBalances();

      // 3.  Position Collateralization Ratio monitor.
      // 3.a Update the client
      await empClient.update();
      // 3.b Check for positions below their CR
      await crMonitor.checkWalletCrRatio();

      // 4. Synthetic peg monitor
      // 4.a Update the price feeds
      await uniswapPriceFeed.update();
      await medianizerPriceFeed.update();
      // 4.b Check for synthetic peg deviation
      await syntheticPegMonitor.checkPriceDeviation();
      // 4.c Check for price feed volatility
      await syntheticPegMonitor.checkPegVolatility();
      await syntheticPegMonitor.checkSyntheticVolatility();

      await delay(Number(pollingDelay));

      if (!shouldPoll) {
        break;
      }
    }
  } catch (error) {
    Logger.error({
      at: "Monitor#index",
      message: "Monitor polling error. Monitor crashed🚨",
      error: new Error(error)
    });
    await waitForLogger(Logger);
  }
}
const Poll = async function(callback) {
  try {
    if (!process.env.EMP_ADDRESS) {
      throw "Bad environment variables! Specify an `EMP_ADDRESS` for the location of the expiring Multi Party.";
    }

    if (!process.env.BOT_MONITOR_OBJECT || !process.env.WALLET_MONITOR_OBJECT) {
      throw "Bad input arg! Specify a `BOT_MONITOR_OBJECT` & `WALLET_MONITOR_OBJECT` to track.";
    }

    const pollingDelay = process.env.POLLING_DELAY ? process.env.POLLING_DELAY : 10000;

    // Bot objects to monitor. For each bot specify a name, address and the thresholds to monitor.
    const botMonitorObject = JSON.parse(process.env.BOT_MONITOR_OBJECT);

    // Wallet objects to monitor.
    const walletMonitorObject = JSON.parse(process.env.WALLET_MONITOR_OBJECT);

    if (!process.env.UNISWAP_PRICE_FEED_CONFIG || !process.env.MEDIANIZER_PRICE_FEED_CONFIG) {
      throw "Bad input arg! Specify `PRICE_FEED_CONFIG` and `MEDIANIZER_PRICE_FEED_CONFIG` to define the price feed settings.";
    }

    // Read price feed configuration from an environment variable.
    const uniswapPriceFeedConfig = JSON.parse(process.env.UNISWAP_PRICE_FEED_CONFIG);
    const medianizerPriceFeedConfig = JSON.parse(process.env.MEDIANIZER_PRICE_FEED_CONFIG);

    if (!process.env.SYNTHETIC_PEG_MONITOR_OBJECT) {
      throw "Bad input arg! Specify `SYNTHETIC_PEG_OBJECT` to parameterize the Synthetic peg monitor.";
    }

    // Read the synthetic peg monitor config from an environment variable.
    const syntheticPegMonitorObject = JSON.parse(process.env.SYNTHETIC_PEG_MONITOR_OBJECT);

    await run(
      process.env.EMP_ADDRESS,
      true,
      botMonitorObject,
      walletMonitorObject,
      syntheticPegMonitorObject,
      pollingDelay,
      uniswapPriceFeedConfig,
      medianizerPriceFeedConfig
    );
  } catch (err) {
    Logger.error({
      at: "Monitor#index🚨",
      message: "Monitor configuration error",
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
