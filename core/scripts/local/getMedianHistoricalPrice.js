/**
 * @notice This is an example script demonstrating how to get a historical median price at a specific timestamp.
 * It could be used for example to query a price before committing a vote for a DVM price request.
 * We provide default configurations for querying median prices on specific markets across some exchanges and markets.
 * This script should serve as a template for constructing other historical median queries.
 *  *
 * @dev How to run: $(npm bin)/truffle exec ./scripts/local/GetMedianHistoricalPrice.js --network mainnet --identifier <PRICE-FEED IDENTIFIER> --time <TIMESTAMP IN SECONDS>
 */
const { fromWei } = web3.utils;
const { createPriceFeed } = require("../../../financial-templates-lib/price-feed/CreatePriceFeed");
const { Networker } = require("../../../financial-templates-lib/price-feed/Networker");
const winston = require("winston");
const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "time"] });

// Pricefeed default configurations to pass into Medianizer price feed. Medianizer returns the median price across specified
// `medianizedFeeds`.
const defaultConfigs = {
  "ETH/BTC": {
    type: "medianizer",
    pair: "ethbtc",
    lookback: 604800,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro" },
      { type: "cryptowatch", exchange: "binance" },
      { type: "cryptowatch", exchange: "bitstamp" }
    ]
  },
  COMPUSD: {
    type: "medianizer",
    lookback: 604800,
    minTimeBetweenUpdates: 60,
    medianizedFeeds: [
      { type: "cryptowatch", exchange: "coinbase-pro", pair: "compusd" },
      { type: "cryptowatch", exchange: "poloniex", pair: "compusdt" },
      { type: "cryptowatch", exchange: "ftx", pair: "compusd" }
    ]
  }
};

async function getMedianHistoricalPrice(callback) {
  try {
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

    // If user did not specify an identifier, provide a default value.
    let queryIdentifier;
    if (!argv.identifier) {
      queryIdentifier = Object.keys(defaultConfigs)[0];
      console.log(`Optional '--identifier' flag not specified, defaulting to: ${queryIdentifier}`);
    } else {
      queryIdentifier = argv.identifier;
    }
    queryIdentifier = queryIdentifier.toUpperCase();

    // Get configuration object from identifier.
    let pricefeedConfig;
    if (!defaultConfigs[queryIdentifier]) {
      throw new Error(
        `Identifier '${queryIdentifier}' not found in defaultConfigs object. Please add to the object to continue. Current available identifiers are [ ${JSON.stringify(
          Object.keys(defaultConfigs)
        )} ].`
      );
    } else {
      pricefeedConfig = defaultConfigs[queryIdentifier];
    }

    // Create and update a new Medianizer price feed.
    let dummyLogger = winston.createLogger({
      silent: true
    });
    const medianizerPriceFeed = await createPriceFeed(
      dummyLogger,
      web3,
      new Networker(dummyLogger),
      getTime,
      pricefeedConfig
    );
    await medianizerPriceFeed.update();

    // Get a price.
    const queryPrice = medianizerPriceFeed.getHistoricalPrice(queryTime);
    console.log(`${queryIdentifier} price @ ${queryTime} = ${fromWei(queryPrice.toString())}`);
  } catch (err) {
    callback(err);
    return;
  }
  callback();
}

module.exports = getMedianHistoricalPrice;
