require("dotenv").config();
const chalkPipe = require("chalk-pipe");
const boldUnderline = chalkPipe("bold.underline");

const { Logger } = require("../financial-templates-lib/logger/Logger");
const winston = require("winston");

const { createPriceFeed } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../financial-templates-lib/price-feed/Networker");

// Clients to retrieve on-chain data.
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { ExpiringMultiPartyEventClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyEventClient");
const { TokenBalanceClient } = require("../financial-templates-lib/clients/TokenBalanceClient");

const { SponsorReporter } = require("./SponsorReporter");
const { GlobalSummaryReporter } = require("./GlobalSummaryReporter");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");

async function run(address, walletsToMonitor, priceFeedConfig, periodLengthSeconds) {
  console.log("Starting Reporter Script🖨");

  // For now we will use a dummy transport to make things quiet in the logs
  const dummyLogger = winston.createLogger({
    level: "error",
    transports: [new winston.transports.Console()]
  });

  // 1. EMP client for getting position information and ecosystem stats.
  const emp = await ExpiringMultiParty.at(address);
  const empClient = new ExpiringMultiPartyClient(dummyLogger, ExpiringMultiParty.abi, web3, emp.address, 10);

  // 2. Price feed for calculating positions CR ratios.
  const getTime = () => Math.round(new Date().getTime() / 1000);
  const priceFeed = await createPriceFeed(dummyLogger, web3, new Networker(dummyLogger), getTime, priceFeedConfig);

  // 3. Token balance client for getting sponsors balances.
  const collateralTokenAddress = await emp.collateralCurrency();
  const syntheticTokenAddress = await emp.tokenCurrency();

  // 4. EMP event client for reading past events.
  const startBlock = 0;
  const empEventClient = new ExpiringMultiPartyEventClient(
    dummyLogger,
    ExpiringMultiParty.abi,
    web3,
    emp.address,
    startBlock
  );

  const tokenBalanceClient = new TokenBalanceClient(
    Logger,
    ExpandedERC20.abi,
    web3,
    collateralTokenAddress,
    syntheticTokenAddress,
    10
  );

  const sponsorReporter = new SponsorReporter(empClient, tokenBalanceClient, walletsToMonitor, priceFeed);

  const globalSummaryReporter = new GlobalSummaryReporter(empClient, empEventClient, priceFeed, periodLengthSeconds);

  console.log(boldUnderline("1. Monitored wallets risk metrics😅"));
  await sponsorReporter.generateMonitoredWalletMetrics();

  console.log(boldUnderline("2. Sponsor table💸"));
  await sponsorReporter.generateSponsorsTable();

  console.log(boldUnderline("3. Global summary stats🌐"));
  await globalSummaryReporter.generateSummaryStatsTable();
}

const Poll = async function(callback) {
  try {
    if (!process.env.EMP_ADDRESS || !process.env.WALLET_MONITOR_OBJECT || !process.env.PRICE_FEED_CONFIG) {
      throw "Bad setup! Must specify EMP_ADDRESS, WALLET_MONITOR_OBJECT and PRICE_FEED_CONFIG";
    }

    // Address of the expiring multi party client on the given network.
    const empAddress = process.env.EMP_ADDRESS;

    // Array of object describing the wallets to generate stats on. Example:
    // WALLET_MONITOR_OBJECT=[{"name":"My sponsor wallet","address":"0x367...afb"},...]
    const walletsToMonitor = JSON.parse(process.env.WALLET_MONITOR_OBJECT);

    // Configuration for price feed object. Example:
    // PRICE_FEED_CONFIG={"type":"medianizer","pair":"ethbtc","lookback":7200,"minTimeBetweenUpdates":60,"medianizedFeeds":[{"type":"cryptowatch","exchange":"coinbase-pro"}]}
    const priceFeedConfig = JSON.parse(process.env.PRICE_FEED_CONFIG);

    // Change `periodLengthSeconds` to modify how far back the report will look for its shorter report period. For example, setting this to
    // `24 * 60 * 60` means that the report will include aggregated data for the past 24 hours.
    const periodLengthSeconds = process.env.PERIOD_REPORT_LENGTH ? process.env.PERIOD_REPORT_LENGTH : 24 * 60 * 60;

    await run(empAddress, walletsToMonitor, priceFeedConfig, periodLengthSeconds);
    callback();
  } catch (err) {
    callback(err);
  }
};

Poll.run = run;
// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
Poll.run = run;
module.exports = Poll;
