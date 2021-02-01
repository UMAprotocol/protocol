/**
 * @notice This is an example script demonstrating how to get a historical median gas price at a specific timestamp.
 * It could be used for example to query a GASETH-TWAP-1Mx1M price before committing a vote for a DVM price request.
 *
 * @dev Prequisites: before running, you will need to set a GOOGLE_APPLICATIONS_CREDENTIALS environment variable for a service account.
 * @dev This service account will need GCP admin or BigQuery permissions. This guide provides further instructions: https://cloud.google.com/docs/authentication/getting-started
 * @dev How to run: yarn truffle exec ./scripts/local/getGasEthHistoricalPrice.js --network mainnet_mnemonic --time 1612137600
 */
const { BigQuery } = require("@google-cloud/bigquery");
const highland = require("highland");
const moment = require("moment");
const { fromWei } = web3.utils;
const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "time"] });
const { createQuery } = require("./GasEthQuery");

const client = new BigQuery();
const dateFormat = "YYYY-MM-DD HH:mm:ss";
const precisionToUse = 18;

async function getGasEthHistoricalPrice(callback) {
  try {
    // If user did not specify an identifier, provide a default value.
    let queryIdentifier;
    if (!argv.identifier) {
      queryIdentifier = "GASETH-TWAP-1Mx1M";
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

    queryTime = new Date(queryTime * 1000);
    // Using moment package to convert queryTime to a usable BQ UTC format.
    let laterTimeBound = moment(queryTime)
      .utc()
      .format(dateFormat);

    // Subtracting 30 days from the current time to give the earlier time bound.
    let earlierTimeBound = moment(queryTime)
      .subtract(30, "days")
      .utc()
      .format(dateFormat);

    // Create the query with the needed time interval.
    const query = createQuery(earlierTimeBound, laterTimeBound);
    // Submit async call to BigQuery and check response.
    let queryPrice;
    try {
      queryPrice = await runQuery(query);
      queryPrice = queryPrice[0].gas_price;
    } catch (err) {
      callback(err);
      return;
    }

    // Scaling by one million as specified in the GASETH-TWAP-1Mx1M UMIP
    queryPrice = queryPrice * 1000000;

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

async function runQuery(query) {
  // returns a node read stream
  const stream = await client.createQueryStream({ query });
  // highland wraps a stream and adds utilities simlar to lodash
  // https://caolan.github.io/highland/
  return (
    highland(stream)
      // from here you can map or reduce or whatever you need for down stream processing
      // we are just going to "collect" stream into an array for display
      .collect()
      // emit the stream as a promise when the stream ends
      // this is the start of a data pipeline so you can imagine
      // this could also "pipe" into some other processing pipeline or write to a file
      .toPromise(Promise)
  );
}

module.exports = getGasEthHistoricalPrice;
