require("dotenv").config();
const { hexToUtf8 } = web3.utils;

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

// Truffle contracts artifacts.
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");

/**
 * @notice Continuously attempts to monitor contract positions and reports based on monitor modules.
 * @param {Number} price Price used to inform the collateralization ratio of positions.
 * @param {String} address Contract address of the EMP.
 * @param {Boolean} shouldPoll If False, then exit after one iteration. Used for testing.
 * @param {Object} botMonitorObject Configuration to construct the balance monitor module.
 * @param {Object} walletMonitorObject Configuration to construct the collateralization ratio monitor module.
 * @param {Object} contractMonitorObject Configuration to construct the contract monitor module.
 * @param {Object} syntheticPegMonitorObject Configuration to construct the synthetic peg monitor module.
 * @param {Number} pollingDelay The amount of milliseconds to wait between iterations.
 * @param {Object} uniswapPriceFeedConfig Configuration to construct the uniswap price feed object.
 * @param {Object} medianizerPriceFeedConfig Configuration to construct the uniswap price feed object.
 * @return None or throws an Error.
 */
async function run(
  address,
  shouldPoll,
  botMonitorObject,
  walletMonitorObject,
  contractMonitorObject,
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
      contractMonitorObject,
      syntheticPegMonitorObject,
      uniswapPriceFeedConfig,
      medianizerPriceFeedConfig
    });

    // 0. Setup EMP and token instances to monitor.
    const emp = await ExpiringMultiParty.at(address);
    const collateralTokenAddress = await emp.collateralCurrency();
    const collateralToken = await ExpandedERC20.at(collateralTokenAddress);
    const syntheticTokenAddress = await emp.tokenCurrency();
    const syntheticToken = await ExpandedERC20.at(syntheticTokenAddress);

    // Generate EMP properties to inform monitor modules of important info like token symbols and price identifier.
    const empProps = {
      collateralCurrencySymbol: await collateralToken.symbol(),
      syntheticCurrencySymbol: await syntheticToken.symbol(),
      priceIdentifier: hexToUtf8(await emp.priceIdentifier()),
      networkId: await web3.eth.net.getId()
    };

    // Setup medianizer price feed.
    const getTime = () => Math.round(new Date().getTime() / 1000);
    const medianizerPriceFeed = await createPriceFeed(
      Logger,
      web3,
      new Networker(Logger),
      getTime,
      medianizerPriceFeedConfig
    );

    // 1. Contract state monitor.
    // Start the event client by looking from the most recent block number. If set to 0 will report past events.
    const latestBlockNumber = (await web3.eth.getBlock("latest")).number;

    const empEventClient = new ExpiringMultiPartyEventClient(
      Logger,
      ExpiringMultiParty.abi,
      web3,
      emp.address,
      latestBlockNumber
    );
    const contractMonitor = new ContractMonitor(
      Logger,
      empEventClient,
      contractMonitorObject,
      medianizerPriceFeed,
      empProps
    );

    // 2. Balance monitor to inform if monitored addresses drop below critical thresholds.
    const tokenBalanceClient = new TokenBalanceClient(
      Logger,
      ExpandedERC20.abi,
      web3,
      collateralTokenAddress,
      syntheticTokenAddress
    );

    const balanceMonitor = new BalanceMonitor(Logger, tokenBalanceClient, botMonitorObject, empProps);

    // 3. Collateralization Ratio monitor.
    const empClient = new ExpiringMultiPartyClient(Logger, ExpiringMultiParty.abi, web3, emp.address);

    const crMonitor = new CRMonitor(Logger, empClient, walletMonitorObject, medianizerPriceFeed, empProps);

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
      syntheticPegMonitorObject,
      empProps
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
      // 1.e Check for new sponsor positions created
      await contractMonitor.checkForNewSponsors();

      // 2.  Wallet Balance monitor
      // 2.a Update the client
      await tokenBalanceClient.update();
      // 2.b Check for monitored bot balance changes
      await balanceMonitor.checkBotBalances();

      // 3.  Position Collateralization Ratio monitor
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
    const pollingDelay = process.env.POLLING_DELAY ? process.env.POLLING_DELAY : 300000;

    if (
      !process.env.BOT_MONITOR_OBJECT ||
      !process.env.WALLET_MONITOR_OBJECT ||
      !process.env.CONTRACT_MONITOR_OBJECT ||
      !process.env.SYNTHETIC_PEG_MONITOR_OBJECT
    ) {
      throw "Bad input arg! Specify a: `BOT_MONITOR_OBJECT`, `WALLET_MONITOR_OBJECT`, `CONTRACT_MONITOR_OBJECT` & `SYNTHETIC_PEG_OBJECT` to track.";
    }

    // Bots to monitor. Each bot can be have a collateralThreshold, syntheticThreshold and etherThreshold. EG:
    // [{ name: "Liquidator Bot",
    //    address: "0x12345"
    //    collateralThreshold: 500000000000000000000, // 500e18 collateral token currency.
    //    syntheticThreshold: 200000000000000000000000, // 20000e18 synthetic token currency.
    //    etherThreshold: 500000000000000000 }, //0.5e18 Wei.
    // ...]
    const botMonitorObject = JSON.parse(process.env.BOT_MONITOR_OBJECT);

    // Wallet objects to monitor. Each wallet has a friendly name and a crAlert. EG:
    // [{ name: "Market Making bot",
    //    address: "0x12345",
    //    crAlert: 1.50 }, // Note 150% is represented as 1.5
    //  ...];
    const walletMonitorObject = JSON.parse(process.env.WALLET_MONITOR_OBJECT);

    // Contract monitor. The monitor needs the addresses of the liquidator and disute bots to inform logs. EG:
    // { "monitoredLiquidators": ["0x1234","0x5678"],
    //   "monitoredDisputers": ["0x1234","0x5678"] }
    const contractMonitorObject = JSON.parse(process.env.CONTRACT_MONITOR_OBJECT);

    // Synthetic Peg monitor. Specify the deviationAlertThreshold, volatilityWindow and volatilityAlertThreshold. EG:
    // { "deviationAlertThreshold": 0.5, // if the deviation in token price exceeds this value an alert is fired.
    //   "volatilityWindow": 600 // Length of time (in seconds) to snapshot volatility.
    //   "volatilityAlertThreshold": 0.1 } // Error threshold for pricefeed's price volatility over `volatilityWindow`.
    const syntheticPegMonitorObject = JSON.parse(process.env.SYNTHETIC_PEG_MONITOR_OBJECT);

    if (!process.env.UNISWAP_PRICE_FEED_CONFIG || !process.env.MEDIANIZER_PRICE_FEED_CONFIG) {
      throw "Bad input arg! Specify `PRICE_FEED_CONFIG` and `MEDIANIZER_PRICE_FEED_CONFIG` to define the price feed settings.";
    }

    // Read price feed configuration from an environment variable. Uniswap price feed contains information about the
    // uniswap market. EG: {"type":"uniswap","twapLength":2,"lookback":7200,"invertPrice":true "uniswapAddress":"0x1234"}
    const uniswapPriceFeedConfig = JSON.parse(process.env.UNISWAP_PRICE_FEED_CONFIG);

    // Medianizer price feed averages over a set of different sources to get an average. Config defines the exchanges
    // to use. EG: {"type":"medianizer","pair":"ethbtc","lookback":7200,"minTimeBetweenUpdates":60,"medianizedFeeds":[
    // {"type":"cryptowatch","exchange":"coinbase-pro"},{"type":"cryptowatch","exchange":"binance"}]}
    const medianizerPriceFeedConfig = JSON.parse(process.env.MEDIANIZER_PRICE_FEED_CONFIG);

    await run(
      process.env.EMP_ADDRESS,
      true,
      botMonitorObject,
      walletMonitorObject,
      contractMonitorObject,
      syntheticPegMonitorObject,
      pollingDelay,
      uniswapPriceFeedConfig,
      medianizerPriceFeedConfig
    );
  } catch (err) {
    Logger.error({
      at: "Monitor#index",
      message: "Monitor configuration error🚨",
      error: new Error(error)
    });
    await waitForLogger(Logger);
    callback(error);
    return;
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
