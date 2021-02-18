const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@uma/common");
const moment = require("moment");

// An implementation of PriceFeedInterface that uses TraderMade api to retrieve prices.
class TraderMadePriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the TraderMadePriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String} pair Representation of the pair the price feed is tracking.
   * @param {String} apiKey TraderMade Data API key.
   * @param {Integer} minuteLookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Integer} hourlyLookback How far in the past the historical prices will be available using getHistoricalPricePeriods.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   * @param {Number} ohlcPeriod Number of minutes interval between ohlc prices requested from TraderMade.
   */
  constructor(
    logger,
    web3,
    apiKey,
    pair,
    minuteLookback,
    hourlyLookback,
    networker,
    getTime,
    minTimeBetweenUpdates,
    priceFeedDecimals = 18,
    ohlcPeriod = 10 // Only 5, 10, 15 minutes is supported by TraderMade.
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;

    this.apiKey = apiKey;
    this.pair = pair;

    this.minuteLookback = minuteLookback;
    this.hourlyLookback = hourlyLookback;
    this.uuid = `TraderMade-${pair}`;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;

    this.toBN = this.web3.utils.toBN;
    this.ohlcPeriod = ohlcPeriod;

    this.priceFeedDecimals = priceFeedDecimals;
    this.ohlcPeriod = ohlcPeriod;

    this.convertPriceFeedDecimals = number => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number
      return this.toBN(parseFixed(number.toString(), priceFeedDecimals).toString());
    };
  }

  getCurrentPrice() {
    return this.currentPrice;
  }

  async getHistoricalPrice(time, verbose = false) {
    if (this.lastUpdateTime === undefined) {
      throw new Error(`${this.uuid}: undefined lastUpdateTime`);
    }

    // Set first price time in `historicalPrices` to first non-null price.
    let firstPriceTime;
    for (let p in this.historicalPricesMinute) {
      if (this.historicalPricesMinute[p] && this.historicalPricesMinute[p].openTime) {
        firstPriceTime = this.historicalPricesMinute[p];
        break;
      }
    }

    // If there are no valid price time, return null.
    if (!firstPriceTime) {
      throw new Error(`${this.uuid}: no valid price time`);
    }

    // If the time is before the first piece of data in the set, return null because
    // the price is before the lookback window.
    if (time < firstPriceTime.openTime) {
      throw new Error(`${this.uuid}: time ${time} is before firstPriceTime.openTime`);
    }

    // historicalPrices are ordered from oldest to newest.
    // This finds the first priceTime whose closeTime is after the provided time.
    const match = this.historicalPricesMinute.find(price => {
      return time < price.closeTime;
    });

    // If there is no match, that means that the time was past the last data point.
    // In this case, the best match for this price is the current price.
    let returnPrice;
    if (match === undefined) {
      returnPrice = this.currentPrice;
      if (verbose) {
        console.group(`\n(${this.pair}) No OHLC available @ ${time}`);
        console.log(
          `- ✅ Time is later than earliest historical time, fetching current price: ${this.web3.utils.fromWei(
            returnPrice.toString()
          )}`
        );
        console.log(
          `- ⚠️  If you want to manually verify the specific exchange prices, you can make a GET request to: \n- https://marketdata.tradermade.com/api/v1/live?currency=${this.pair}&api_key={api-key}`
        );
        console.groupEnd();
      }
      return this.currentPrice;
    }

    returnPrice = match.closePrice;
    if (verbose) {
      console.group(`\n(${this.pair}) Historical OHLC @ ${match.closeTime}`);
      console.log(`- ✅ Close Price:${this.web3.utils.fromWei(returnPrice.toString())}`);
      console.log(
        `- ⚠️  If you want to manually verify the specific exchange prices, you can make a GET request to: \n- https://marketdata.tradermade.com/api/v1/timeseries?currency=${this.pair}&api_key={api-key}&start_date=${time}&end_date=${match.closeTime}&format=records&interval=minute&period=${this.ohlcPeriod}`
      );
      console.groupEnd();
    }
    return returnPrice;
  }

  getHistoricalPricePeriods() {
    return this.historicalPricesHourly;
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  getMinuteLookback() {
    return this.minuteLookback;
  }

  getHourlyLookback() {
    return this.hourlyLookback;
  }

  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }

  async updateLatest(lastUpdateTime) {
    const currentTime = this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== undefined && lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "TraderMadePriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTimes + this.minTimeBetweenUpdates - currentTime
      });
      return;
    }

    this.logger.debug({
      at: "TraderMade_PriceFeed",
      message: "Updating Latest Price",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // 1. Construct URLs.
    const priceUrl = `https://marketdata.tradermade.com/api/v1/live?currency=${this.pair}&api_key=${this.apiKey}`;

    // 2. Send requests.
    const priceResponse = await this.networker.getJson(priceUrl);

    // 4. Parse results.
    // Return data structure:
    //  {
    //     "endpoint": "live",
    //     "quotes": [
    //       {
    //         "ask": 0.15431,
    //         "base_currency": "CNY",
    //         "bid": 0.15431,
    //         "mid": 0.15431,
    //         "quote_currency": "USD"
    //       }
    //     ],
    //     "requested_time": "Tue, 26 Jan 2021 01:29:52 GMT",
    //     "timestamp": 1611624593
    //   }
    // For more info, see: https://marketdata.tradermade.com/documentation
    const newPrice = this.convertPriceFeedDecimals(priceResponse.quotes[0].ask);

    // 5. Store results.
    this.currentPrice = newPrice;
    this.lastUpdateTime = currentTime;
  }

  async updateMinute(lastUpdateTime) {
    const currentTime = this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== undefined && lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      return;
    }

    this.logger.debug({
      at: "TraderMade_PriceFeed",
      message: "Updating Minute Price",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // Round down to the nearest ohlc period so the queries captures the OHLC of the period *before* this earliest
    // timestamp (because the close of that OHLC may be relevant).
    const earliestMinuteHistoricalTimestamp =
      Math.floor((currentTime - this.minuteLookback) / (this.ohlcPeriod * 60)) * (this.ohlcPeriod * 60);
    const endDate = this._secondToDateTime(currentTime);
    const startMinuteDate = this._secondToDateTime(earliestMinuteHistoricalTimestamp);

    // 1. Construct URLs.
    const ohlcMinuteUrl = `https://marketdata.tradermade.com/api/v1/timeseries?currency=${this.pair}&api_key=${this.apiKey}&start_date=${startMinuteDate}&end_date=${endDate}&format=records&interval=minute&period=${this.ohlcPeriod}`;

    // 2. Send requests.
    const ohlcMinuteResponse = await this.networker.getJson(ohlcMinuteUrl);

    // 3. Check responses.
    if (!ohlcMinuteResponse || !ohlcMinuteResponse.quotes || !ohlcMinuteResponse.quotes[0].close) {
      throw new Error(
        `🚨Could not parse ohlc minute price result from url ${ohlcMinuteUrl}: ${JSON.stringify(ohlcMinuteResponse)}`
      );
    }

    // Return data structure:
    // {
    //   "base_currency": "CNY",
    //   "end_date": "2021-01-26 03:31:00",
    //   "endpoint": "timeseries",
    //   "quote_currency": "USD",
    //   "quotes": [
    //     {
    //       "close": 0.1543,
    //       "date": "2021-01-26 00:01:00",
    //       "high": 0.1543,
    //       "low": 0.1543,
    //       "open": 0.1543
    //     },
    //     ...
    //   ]
    //   "request_time": "Wed, 27 Jan 2021 01:45:28 GMT",
    //   "start_date": "2021-01-26-00:01"
    // }
    // For more info, see: https://marketdata.tradermade.com/documentation
    const newHistoricalPricesMinute = ohlcMinuteResponse.quotes
      .map(ohlcMinute => ({
        // Output data should be a list of objects with only the open and close times and prices.
        closePrice: this.convertPriceFeedDecimals(ohlcMinute.close),
        openTime: this._dateTimeToSecond(ohlcMinute.date) - this.ohlcPeriod * 60,
        closeTime: this._dateTimeToSecond(ohlcMinute.date)
      }))
      .sort((a, b) => {
        // Sorts the data such that the oldest elements come first.
        return a.openTime - b.openTime;
      });

    // 5. Store results.
    this.historicalPricesMinute = newHistoricalPricesMinute;
  }

  async updateHourly(lastUpdateTime) {
    const currentTime = this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== undefined && lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      return;
    }

    this.logger.debug({
      at: "TraderMade_PriceFeed",
      message: "Updating Hourly Price",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // Round down to the nearest ohlc period so the queries captures the OHLC of the period *before* this earliest
    // timestamp (because the close of that OHLC may be relevant).
    const earliestHourlyHistoricalTimestamp = Math.floor((currentTime - this.hourlyLookback) / 3600) * 3600;
    const endDate = this._secondToDateTime(currentTime);
    const startHourlyDate = this._secondToDateTime(earliestHourlyHistoricalTimestamp);

    // 1. Construct URLs.
    const ohlcHourlyUrl = `https://marketdata.tradermade.com/api/v1/timeseries?currency=${this.pair}&api_key=${this.apiKey}&start_date=${startHourlyDate}&end_date=${endDate}&format=records&interval=hourly`;

    // 2. Send requests.
    const ohlcHourlyResponse = await this.networker.getJson(ohlcHourlyUrl);

    // 3. Check responses.
    if (!ohlcHourlyResponse || !ohlcHourlyResponse.quotes || !ohlcHourlyResponse.quotes[0].close) {
      throw new Error(
        `🚨Could not parse ohlc hourly price result from url ${ohlcHourlyUrl}: ${JSON.stringify(ohlcHourlyResponse)}`
      );
    }

    // Return data structure:
    // {
    //   "base_currency": "CNY",
    //   "end_date": "2021-01-26 03:31:00",
    //   "endpoint": "timeseries",
    //   "quote_currency": "USD",
    //   "quotes": [
    //     {
    //       "close": 0.1543,
    //       "date": "2021-01-26 00:00:00",
    //       "high": 0.1543,
    //       "low": 0.1543,
    //       "open": 0.1543
    //     },
    //     ...
    //   ]
    //   "request_time": "Wed, 27 Jan 2021 01:45:28 GMT",
    //   "start_date": "2021-01-26-00:01"
    // }
    // For more info, see: https://marketdata.tradermade.com/documentation
    const newHistoricalPricesHourly = ohlcHourlyResponse.quotes
      .map(ohlcHourly => ({
        // Output data should be a list of objects with only the open and close times and prices.
        closePrice: this.convertPriceFeedDecimals(ohlcHourly.close),
        openTime: this._dateTimeToSecond(ohlcHourly.date) - 3600,
        closeTime: this._dateTimeToSecond(ohlcHourly.date)
      }))
      .sort((a, b) => {
        // Sorts the data such that the oldest elements come first.
        return a.closeTime - b.closeTime;
      });

    // 5. Store results.
    this.historicalPricesHourly = newHistoricalPricesHourly;
  }

  async update() {
    const lastUpdateTime = this.lastUpdateTime;
    await this.updateLatest(lastUpdateTime);
    if (this.minuteLookback) {
      await this.updateMinute(lastUpdateTime);
    }
    if (this.hourlyLookback) {
      await this.updateHourly(lastUpdateTime);
    }
  }

  _secondToDateTime(inputSecond) {
    return moment.unix(inputSecond).format("YYYY-MM-DD-HH:mm");
  }

  _dateTimeToSecond(inputDateTime) {
    return moment(inputDateTime, "YYYY-MM-DD HH:mm").unix();
  }
}

module.exports = {
  TraderMadePriceFeed
};
