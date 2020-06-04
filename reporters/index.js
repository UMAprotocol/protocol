require("dotenv").config();
const chalkPipe = require("chalk-pipe");
const boldUnderline = chalkPipe("bold.underline");
const boldUnderlineRed = chalkPipe("bold.underline.red");

const { Logger } = require("../financial-templates-lib/logger/Logger");
const winston = require("winston");

const { createPriceFeed } = require("../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../financial-templates-lib/price-feed/Networker");

// Clients to retrieve on-chain data.
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyClient");
const { ExpiringMultiPartyEventClient } = require("../financial-templates-lib/clients/ExpiringMultiPartyEventClient");
const { TokenBalanceClient } = require("../financial-templates-lib/clients/TokenBalanceClient");

// DVM utils.
const { interfaceName } = require("../core/utils/Constants");

const { SponsorReporter } = require("./SponsorReporter");
const { GlobalSummaryReporter } = require("./GlobalSummaryReporter");

// Truffle contracts
const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");
const ExpandedERC20 = artifacts.require("ExpandedERC20");
const OracleInterface = artifacts.require("OracleInterface");
const Finder = artifacts.require("Finder");

async function run(
  address,
  walletsToMonitor,
  referencePriceFeedConfig,
  uniswapPriceFeedConfig,
  periodLengthSeconds,
  endDateOffsetSeconds
) {
  console.log(boldUnderlineRed("Starting Reporter Script🖨\n"));

  // For now we will use a dummy transport to make things quiet in the logs
  const dummyLogger = winston.createLogger({
    level: "error",
    transports: [new winston.transports.Console()]
  });

  // 1. EMP client for getting position information and ecosystem stats.
  const emp = await ExpiringMultiParty.at(address);
  const empClient = new ExpiringMultiPartyClient(dummyLogger, ExpiringMultiParty.abi, web3, emp.address, 10);

  // 2a. Reference price feed for calculating "actual" positions CR ratios.
  const getTime = () => Math.round(new Date().getTime() / 1000);
  const referencePriceFeed = await createPriceFeed(
    dummyLogger,
    web3,
    new Networker(dummyLogger),
    getTime,
    referencePriceFeedConfig
  );

  // 2b. Uniswap price feed for calculating synthetic token trading stats.
  const uniswapPriceFeed = await createPriceFeed(
    dummyLogger,
    web3,
    new Networker(dummyLogger),
    getTime,
    uniswapPriceFeedConfig
  );

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

  // 5. Oracle contract for fetching EMP dispute resolution prices.
  const finder = await Finder.deployed();
  const oracle = await OracleInterface.at(
    await finder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
  );

  // 6. Token contracts for tracking events.
  const collateralToken = await ExpandedERC20.at(await emp.collateralCurrency());
  const syntheticToken = await ExpandedERC20.at(await emp.tokenCurrency());

  const tokenBalanceClient = new TokenBalanceClient(
    Logger,
    ExpandedERC20.abi,
    web3,
    collateralTokenAddress,
    syntheticTokenAddress,
    10
  );

  const sponsorReporter = new SponsorReporter(empClient, tokenBalanceClient, walletsToMonitor, referencePriceFeed);

  const globalSummaryReporter = new GlobalSummaryReporter(
    empClient,
    empEventClient,
    referencePriceFeed,
    uniswapPriceFeed,
    oracle,
    collateralToken,
    syntheticToken,
    endDateOffsetSeconds,
    periodLengthSeconds
  );

  console.log(boldUnderline("1. Monitored wallets risk metrics🔎"));
  await sponsorReporter.generateMonitoredWalletMetrics();

  console.log(boldUnderline("2. Sponsor table💸"));
  await sponsorReporter.generateSponsorsTable();

  console.log(boldUnderline("3. Global summary stats🌎"));
  await globalSummaryReporter.generateSummaryStatsTable();
}

const Poll = async function(callback) {
  try {
    if (
      !process.env.EMP_ADDRESS ||
      !process.env.WALLET_MONITOR_OBJECT ||
      !process.env.PRICE_FEED_CONFIG ||
      !process.env.UNISWAP_PRICE_FEED_CONFIG
    ) {
      throw "Bad setup! Must specify EMP_ADDRESS, WALLET_MONITOR_OBJECT, PRICE_FEED_CONFIG, and UNISWAP_PRICE_FEED_CONFIG";
    }

    // Address of the expiring multi party client on the given network.
    const empAddress = process.env.EMP_ADDRESS;

    // Array of object describing the wallets to generate stats on. Example:
    // WALLET_MONITOR_OBJECT=[{"name":"My sponsor wallet","address":"0x367...afb"},...]
    const walletsToMonitor = JSON.parse(process.env.WALLET_MONITOR_OBJECT);

    // Configuration for price feed objects. Example:
    // PRICE_FEED_CONFIG={"type":"medianizer","pair":"ethbtc","lookback":7200,"minTimeBetweenUpdates":60,"medianizedFeeds":[{"type":"cryptowatch","exchange":"coinbase-pro"}]}
    const referencePriceFeedConfig = JSON.parse(process.env.PRICE_FEED_CONFIG);
    // UNISWAP_PRICE_FEED_CONFIG={"type":"uniswap","twapLength":86400,"lookback":7200,"invertPrice":true,"uniswapAddress":"0x1e4F65138Bbdb66b9C4140b2b18255A896272338"}
    const uniswapPriceFeedConfig = JSON.parse(process.env.UNISWAP_PRICE_FEED_CONFIG);

    // The report will always display "cumulative" and "current" data but it will also show data for a shorter period ("period") whose
    // start and end dates we can control:

    // Change `endDateOffsetSeconds` to modify the end date for the "period". End date will be (now - endDateOffsetSeconds).
    const endDateOffsetSeconds =
      process.env.PERIOD_END_DATE_OFFSET && process.env.PERIOD_END_DATE_OFFSET > 0
        ? Math.round(process.env.PERIOD_END_DATE_OFFSET)
        : 0;

    // Change `periodLengthSeconds` to modify the "period" start date. Start date will be (endDate - periodLengthSeconds).
    const periodLengthSeconds =
      process.env.PERIOD_REPORT_LENGTH && process.env.PERIOD_REPORT_LENGTH > 0
        ? Math.round(process.env.PERIOD_REPORT_LENGTH)
        : 24 * 60 * 60;

    await run(
      empAddress,
      walletsToMonitor,
      referencePriceFeedConfig,
      uniswapPriceFeedConfig,
      periodLengthSeconds,
      endDateOffsetSeconds
    );
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
