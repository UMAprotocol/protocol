/**
 * @notice This is an example script demonstrating how to get a historical median price at a specific timestamp.
 * It could be used for example to query a price before committing a vote for a DVM price request.
 * We provide default configurations for querying median prices on specific markets across some exchanges and markets.
 * This script should serve as a template for constructing other historical median queries.
 *  *
 * @dev How to run: yarn truffle exec ./packages/core/scripts/local/getMedianHistoricalPrice.js --network mainnet_mnemonic --identifier USDBTC --time 1601503200
 */
const { fromWei } = web3.utils;
const { createReferencePriceFeedForEmp, Networker } = require("@uma/financial-templates-lib");
const winston = require("winston");
const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "time"] });

const UMIP_PRECISION = {
  USDBTC: 8,
  USDETH: 5
};
const DEFAULT_PRECISION = 5;

async function getMedianHistoricalPrice(callback) {
  try {
    // If user did not specify an identifier, provide a default value.
    let queryIdentifier;
    if (!argv.identifier) {
      queryIdentifier = "eth/btc";
      console.log(`Optional '--identifier' flag not specified, defaulting to: ${queryIdentifier}`);
    } else {
      queryIdentifier = argv.identifier;
    }
    queryIdentifier = queryIdentifier.toUpperCase();

    // Function to get the current time.
    const getTime = () => Math.round(new Date().getTime() / 1000);

    // Create and update a new Medianizer price feed.
    let dummyLogger = winston.createLogger({
      silent: true
    });
    const medianizerPriceFeed = await createReferencePriceFeedForEmp(
      dummyLogger,
      web3,
      new Networker(dummyLogger),
      getTime,
      null,
      { lookback: 345600 }, // Empirically, Cryptowatch API returns data up to ~4 days back.
      queryIdentifier
    );
    if (!medianizerPriceFeed) {
      throw new Error(`Failed to construct medianizer price feed for the ${queryIdentifier} identifier`);
    }
    await medianizerPriceFeed.update();

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

    // Get a price. This requests the Cryptowatch API for the specific exchange prices at the timestamp.
    // The default exchanges to fetch prices for are based on UMIP's and can be found in:
    // protocol/financial-templates-lib/src/price-feed/CreatePriceFeed.js
    const queryPrice = medianizerPriceFeed.getHistoricalPrice(queryTime, true);
    const precisionToUse = UMIP_PRECISION[queryIdentifier] ? UMIP_PRECISION[queryIdentifier] : DEFAULT_PRECISION;
    console.log(
      `\n💹 Median ${queryIdentifier} price @ ${queryTime} = ${Number(fromWei(queryPrice.toString())).toFixed(
        precisionToUse
      )}`
    );

    console.log(
      "\n⚠️ If you want to manually verify the specific exchange prices, you can make GET requests to: \n- https://api.cryptowat.ch/markets/<EXCHANGE-NAME>/<PAIR>/ohlc?after=<TIMESTAMP>&before=<TIMESTAMP>&periods=60"
    );
    console.log(
      "- e.g. curl https://api.cryptowat.ch/markets/coinbase-pro/ethusd/ohlc?after=1601503080&before=1601503080&periods=60"
    );
    console.log(
      '\n⚠️ This will return an OHLC data packet as "result", which contains in order: \n- [CloseTime, OpenPrice, HighPrice, LowPrice, ClosePrice, Volume, QuoteVolume].'
    );
    console.log(
      "- We use the OpenPrice to compute the median. Note that you might need to invert the prices for certain identifiers like USDETH."
    );
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = getMedianHistoricalPrice;
