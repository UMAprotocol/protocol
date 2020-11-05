const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BigQuery } = require("@google-cloud/bigquery");
const moment = require("moment");
const highland = require("highland");
const { parseFixed } = require("@ethersproject/bignumber");

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
  constructor(logger, web3, lookback, getTime, minTimeBetweenUpdates, decimals = 0) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.lookback = lookback;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.toBN = this.web3.utils.toBN;

    this.convertDecimals = number => {
      // Converts price result to wei and returns price conversion to correct decimals as a big number.
      return this.toBN(parseFixed(number.toString(), decimals).toString());
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
    const formattedCurrentTime = moment(time)
      .utc()
      .format("YYYY-MM-DD HH:mm:ss");

    // 2592000000 is a month time interval
    let t2 = new Date(time);
    t2 = moment(t2)
      .subtract(30, "days")
      .utc()
      .format("YYYY-MM-DD HH:mm:ss");

    // Create the query with the needed time interval.
    const query = this.createQuery(t2, formattedCurrentTime);

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
      .format("YYYY-MM-DD HH:mm:ss");

    // Subtracting 30 days from current time to create the earlier time bound.
    let t2 = new Date();
    t2 = moment(t2)
      .subtract(30, "days")
      .utc()
      .format("YYYY-MM-DD HH:mm:ss");

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
    const query = this.createQuery(t2, formattedCurrentTime);

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
  // This is a helper method to create a GASETH BQ query with time arguments.
  createQuery(t2, formattedCurrentTime) {
    const query = `
        DECLARE halfway int64;
        DECLARE block_count int64;
        DECLARE max_block int64;

        -- Querying for the amount of blocks in the preset time range. This will allow block_count to be compared against a given minimum block amount.
        SET (block_count, max_block) = (SELECT AS STRUCT (MAX(number) - MIN(number)), MAX(number) FROM \`bigquery-public-data.crypto_ethereum.blocks\` 
        WHERE timestamp BETWEEN TIMESTAMP('${t2}', 'UTC') AND TIMESTAMP('${formattedCurrentTime}', 'UTC'));

        CREATE TEMP TABLE cum_gas (
        gas_price int64,
        cum_sum int64
        );

        -- If the minimum threshold of blocks is met, query on a time range
        IF block_count >= 134400 THEN
        INSERT INTO cum_gas (
        SELECT
            gas_price,
            SUM(gas_used) OVER (ORDER BY gas_price) AS cum_sum
        FROM (
            SELECT
            gas_price,
            SUM(receipt_gas_used) AS gas_used
            FROM
            \`bigquery-public-data.crypto_ethereum.transactions\`
            WHERE block_timestamp 
            BETWEEN TIMESTAMP('${t2}', 'UTC')
            AND TIMESTAMP('${formattedCurrentTime}', 'UTC')  
            GROUP BY
            gas_price));
        ELSE -- If a minimum threshold of blocks is not met, query for the minimum amount of blocks
        INSERT INTO cum_gas (
        SELECT
            gas_price,
            SUM(gas_used) OVER (ORDER BY gas_price) AS cum_sum
        FROM (
            SELECT
            gas_price,
            SUM(receipt_gas_used) AS gas_used
            FROM
            \`bigquery-public-data.crypto_ethereum.transactions\`
            WHERE block_number 
            BETWEEN (max_block - 134400)
            AND max_block
            GROUP BY
            gas_price));
        END IF;

        SET halfway = (SELECT DIV(MAX(cum_sum),2) FROM cum_gas);

        SELECT cum_sum, gas_price FROM cum_gas WHERE cum_sum > halfway ORDER BY gas_price LIMIT 1;
    `;

    return query;
  }
}

module.exports = {
  BigQueryPriceFeed
};
