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
      { lookback: 345600 }, // Empirically, Cryptowatch API only returns data up to ~4 days back.
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

    // The default exchanges to fetch prices for (and from which the median is derived) are based on UMIP's and can be found in:
    // protocol/financial-templates-lib/src/price-feed/CreatePriceFeed.js
    const queryPrice = medianizerPriceFeed.getHistoricalPrice(queryTime, true);
    const precisionToUse = UMIP_PRECISION[queryIdentifier] ? UMIP_PRECISION[queryIdentifier] : DEFAULT_PRECISION;
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
