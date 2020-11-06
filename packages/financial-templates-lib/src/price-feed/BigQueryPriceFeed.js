const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BigQuery } = require("@google-cloud/bigquery");
const moment = require("moment");
const highland = require("highland");
const { parseFixed } = require("@ethersproject/bignumber");
const { createQuery } = require("../queries/GasEthQuery");

const client = new BigQuery();

// An implementation of PriceFeedInterface that uses BigQuery to retrieve prices.
class BigQueryPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the BigQueryPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Number} decimals Number of decimals to use to convert price to wei.
   */
  constructor(logger, web3, lookback, getTime, minTimeBetweenUpdates, decimals = 18) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.lookback = lookback;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.toBN = this.web3.utils.toBN;
    this.dateConversionString = "YYYY-MM-DD HH:mm:ss";

    this.convertDecimals = number => {
      // Converts price result to wei and returns price conversion to correct decimals as a big number.
      return this.toBN(parseFixed(number.toString(), decimals - 18).toString());
    };
  }

  getCurrentPrice() {
    return this.currentPrice;
  }

  async getHistoricalPrice(time) {
    if (this.lastUpdateTime === undefined) {
      return undefined;
    }

    // Using moment package to changeto UTC and create acceptable format for BQ.
    const laterHistoricTimeBound = moment(time)
      .utc()
      .format(this.dateConversionString);

    // Subtracting 30 days from the current time to give the earlier time bound.
    let earlierTimeBound = new Date(time);
    earlierTimeBound = moment(earlierTimeBound)
      .subtract(30, "days")
      .utc()
      .format(this.dateConversionString);

    // Create the query with the needed time interval.
    const query = createQuery(earlierTimeBound, laterHistoricTimeBound);

    // Submit async call to BigQuery and check the response.
    let priceResponse;
    try {
      priceResponse = await this.runQuery(query);
      priceResponse = priceResponse[0].gas_price;
      console.log(priceResponse);
    } catch (error) {
      throw new Error(`🚨Could not parse price result from bigquery: ${priceResponse}`);
    }

    const returnPrice = this.convertDecimals(priceResponse);

    return returnPrice;
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  async update() {
    // Using current time minus 5 minutes as end-bound of query. This is because the BQ dataset lags ~5 minutes.
    // Using moment package to change to UTC and create acceptable format for BQ.
    const currentTime = new Date();
    const formattedCurrentTime = moment(currentTime)
      .subtract(5, "minutes")
      .utc()
      .format(this.dateConversionString);

    // Subtracting 30 days from current time to create the earlier time bound.
    let earlierTimeBound = new Date();
    earlierTimeBound = moment(earlierTimeBound)
      .subtract(30, "days")
      .utc()
      .format(this.dateConversionString);

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== undefined && this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "BigQueryPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTimes + this.minTimeBetweenUpdates - currentTime
      });
      return;
    }

    this.logger.debug({
      at: "BigQueryPriceFeed",
      message: "Updating",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // Create the query with the needed time interval.
    const query = createQuery(earlierTimeBound, formattedCurrentTime);

    // Submit async call to BigQuery and check response.
    let priceResponse;
    try {
      priceResponse = await this.runQuery(query);
      priceResponse = priceResponse[0].gas_price;
      console.log(priceResponse);
    } catch (error) {
      throw new Error(`🚨Could not parse price result from bigquery: ${priceResponse}`);
    }

    const newPrice = this.convertDecimals(priceResponse);

    // Store results.
    this.currentPrice = newPrice;
    this.lastUpdateTime = currentTime;
  }
  async runQuery(query) {
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
}

module.exports = {
  BigQueryPriceFeed
};
