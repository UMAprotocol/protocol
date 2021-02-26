/**
 * @notice This is an example script demonstrating how to get a historical median price at a specific timestamp.
 * It could be used for example to query a price before committing a vote for a DVM price request.
 * We provide default configurations for querying median prices on specific markets across some exchanges and markets.
 * This script should serve as a template for constructing other historical median queries.
 *
 * @notice This script will fail if the `--time` is not within a 4 day lookback window and one of the medianized pricefeeds is a cryptowatch price feed.
 * @dev How to run: yarn truffle exec ./packages/core/scripts/local/getMedianHistoricalPrice.js --network mainnet_mnemonic --identifier USDBTC --time 1601503200
 */
const { fromWei } = web3.utils;
const { createReferencePriceFeedForFinancialContract, Networker } = require("@uma/financial-templates-lib");
const winston = require("winston");
const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "time"] });
require("dotenv").config();

const UMIP_PRECISION = {
  USDBTC: 8,
  USDETH: 5,
  BTCDOM: 2,
  ALTDOM: 2,
  BCHNBTC: 8,
  "GASETH-TWAP-1Mx1M": 18,
  "USD-[bwBTC/ETH SLP]": 18,
  "USD/bBadger": 18
};
const DEFAULT_PRECISION = 5;

async function getMedianHistoricalPrice(callback) {
  try {
    // If user did not specify an identifier, provide a default value.
    let queryIdentifier;
    if (!argv.identifier) {
      queryIdentifier = "ETH/BTC";
      console.log(`Optional '--identifier' flag not specified, defaulting to: ${queryIdentifier}`);
    } else {
      queryIdentifier = argv.identifier;
    }

    // Function to get the current time.
    const getTime = () => Math.round(new Date().getTime() / 1000);

    // If user specified a timestamp, then use it, otherwise default to the current time.
    let queryTime;
    if (!argv.time) {
      queryTime = getTime();
      console.log(
        `Optional '--time' flag not specified, defaulting to the current Unix timestamp (in seconds): ${queryTime}`
      );
    } else {
      queryTime = argv.time;
    }
    console.log(`⏰ Fetching nearest prices for the timestamp: ${new Date(queryTime * 1000).toUTCString()}`);
    const lookback = Math.round(Math.max(getTime() - queryTime, 1800));

    // Create and update a new Medianizer price feed.
    let dummyLogger = winston.createLogger({
      silent: true
    });
    let priceFeedConfig = {
      // Empirically, Cryptowatch API only returns data up to ~4 days back.
      lookback,
      priceFeedDecimals: 18, // Ensure all prices come out as 18-decimal denominated so the fromWei conversion works at the end.
      // Append price feed config params from environment such as "apiKey" for CryptoWatch price feeds.
      ...(process.env.PRICE_FEED_CONFIG ? JSON.parse(process.env.PRICE_FEED_CONFIG) : {})
    };
    const medianizerPriceFeed = await createReferencePriceFeedForFinancialContract(
      dummyLogger,
      web3,
      new Networker(dummyLogger),
      getTime,
      null,
      priceFeedConfig,
      queryIdentifier
    );
    if (!medianizerPriceFeed) {
      throw new Error(`Failed to construct medianizer price feed for the ${queryIdentifier} identifier`);
    }

    await medianizerPriceFeed.update();

    // The default exchanges to fetch prices for (and from which the median is derived) are based on UMIP's and can be found in:
    // protocol/financial-templates-lib/src/price-feed/CreatePriceFeed.js
    const queryPrice = await medianizerPriceFeed.getHistoricalPrice(queryTime, true);
    const precisionToUse = UMIP_PRECISION[queryIdentifier] ? UMIP_PRECISION[queryIdentifier] : DEFAULT_PRECISION;
    console.log(`\n⚠️ Truncating price to ${precisionToUse} decimals`);
    console.log(
      `\n💹 Median ${queryIdentifier} price @ ${queryTime} = ${Number(fromWei(queryPrice.toString())).toFixed(
        precisionToUse
      )}`
    );
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = getMedianHistoricalPrice;
