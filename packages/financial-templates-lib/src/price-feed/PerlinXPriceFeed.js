const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@ethersproject/bignumber");

// An implementation of PriceFeedInterface that uses to retrive the price of XAUUSD from Tradermade's API and XAUPERL from the combination of Tradermade and Binance
class PerlinXPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the CryptoWatchPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String} tradermadeApiKey Tradermade's API key. Note: these API keys are rate-limited.
   * @param {String} cryptowatchApiKey Cryptowatch's API key. Note:For getting PERL price
   * @param {String} pair Representation of the pair the price feed is tracking.
   * @param {String} convertToPerl Use PERL ERC-20 as a base currency
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Bool} invertPrice Indicates if prices should be inverted before returned.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   * @param {Number} periods Number of minutes interval between price entries.
   */
  constructor(
    logger,
    web3,
    tradermadeApiKey,
    cryptowatchApiKey,
    pair,
    convertToPerl,
    lookback,
    networker,
    getTime,
    minTimeBetweenUpdates,
    invertPrice,
    priceFeedDecimals = 18,
    periods = 1
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;

    this.tradermadeApiKey = tradermadeApiKey;
    this.cryptowatchApiKey = cryptowatchApiKey;
    this.pair = pair;
    this.convertToPerl = convertToPerl;
    this.lookback = lookback;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.invertPrice = invertPrice;
    this.priceFeedDecimals = priceFeedDecimals;
    this.periods = periods;

    this.toBN = this.web3.utils.toBN;

    this.convertPriceFeedDecimals = number => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number.
      // Note: Must ensure that `number` has no more decimal places than `priceFeedDecimals`.
      return this.toBN(parseFixed(number.toString().substring(0, priceFeedDecimals), priceFeedDecimals).toString());
    };
  }

  getCurrentPrice() {
    return this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
  }

  getHistoricalPrice(time, verbose = false) {
    if (this.lastUpdateTime === undefined) {
      return null;
    }

    // Set first price period in `historicalPrices` to first non-null price.
    let firstEntry;
    for (const row of this.historicalPricePeriods) {
      if (row && row.openTime && row.closeTime && row.closePrice) {
        firstEntry = row;
        break;
      }
    }

    // If there are no valid price periods, return null.
    if (!firstEntry) {
      return null;
    }

    // If the time is before the first piece of data in the set, return null because
    // the price is before the lookback window.
    if (time < firstEntry.openTime) {
      return null;
    }

    // `historicalPrices` are ordered from oldest to newest.
    // Find the first entry that is after the requested timestamp
    const match = this.historicalPricePeriods.find(pricePeriod => {
      return time < pricePeriod.closeTime;
    });

    // If there is no match, that means that the time was past the last data point.
    // In this case, the best match for this price is the current price.
    if (match === undefined) {
      let returnPrice = this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
      if (verbose) {
        const priceDisplay = this.convertPriceFeedDecimals(returnPrice.toString());

        console.group(`\n(${this.pair}) No historical price available @ ${time}`);
        console.log(`- ✅ Time is later than earliest historical time, fetching current price: ${priceDisplay}`);
        console.log(
          `- ⚠️  If you want to manually verify the specific prices, you can make a GET request to: \n- ${this._priceUrl}`
        );
        console.groupEnd();
      }
      return this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
    }

    let returnPrice = this.invertPrice ? this._invertPriceSafely(match.closePrice) : match.closePrice;
    if (verbose) {
      console.group(`\n(${this.pair}) Historical Prices @ ${match.closeTime}`);
      console.log(`- ✅ Price: ${this.convertPriceFeedDecimals(returnPrice.toString())}`);
      console.log(
        `- ⚠️  If you want to manually verify the specific exchange prices, you can make a GET request to: \n  - ${this._historicalPricesUrl}`
      );
      console.log(
        '- This will return the historical prices as "data.rows". Each row contains: [unix_timestamp, price].'
      );
      console.log("- Note that you might need to invert the prices for certain identifiers.");
      console.groupEnd();
    }
    return returnPrice;
  }

  getHistoricalPricePeriods() {
    if (!this.invertPrice) return this.historicalPricePeriods;
    else
      return this.historicalPricePeriods.map(historicalPrice => {
        return {
          ...historicalPrice,
          closePrice: this._invertPriceSafely(historicalPrice.closePrice)
        };
      });
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  getLookback() {
    return this.lookback;
  }

  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }

  async update() {
    const currentTime = this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== undefined && this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "PerlinXPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTimes + this.minTimeBetweenUpdates - currentTime
      });
      return;
    }

    this.logger.debug({
      at: "PerlinXPriceFeed",
      message: "Updating PerlinXPriceFeed",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // 1. Construct URLs.
    // See https://marketdata.tradermade.com/documentation for how this url is constructed.
    const priceUrl = `https://marketdata.tradermade.com/api/v1/minute_historical?currency=${
      this.pair
    }&date_time=${this._getFormattedDate(currentTime)}&api_key=${this.tradermadeApiKey}`;

    const historicalPricesUrl = `https://marketdata.tradermade.com/api/v1/timeseries?currency=${this.pair}&api_key=${
      this.tradermadeApiKey
    }&start_date=${this._getFormattedDate(currentTime - this.lookback)}&end_date=${this._getFormattedDate(
      currentTime
    )}&format=records&interval=minute&period=${this.periods}`;

    // 2. Send requests.
    const [priceResponse, historyResponse] = await Promise.all([
      this.networker.getJson(priceUrl),
      this.networker.getJson(historicalPricesUrl)
    ]);

    // 3. Check responses.
    if (!priceResponse || !priceResponse.close || typeof priceResponse.close !== "number") {
      throw new Error(`🚨Could not parse price result from url ${priceUrl}: ${JSON.stringify(priceResponse)}`);
    }

    if (!historyResponse || !historyResponse.quotes || !Array.isArray(historyResponse.quotes)) {
      throw new Error(
        `🚨Could not parse history result from url ${historicalPricesUrl}: ${JSON.stringify(historyResponse)}`
      );
    }

    // 4. Parse results.
    // Looks for current PERL price if this.convertToPerl has been set
    let perlPerUsd = 0;
    if (this.convertToPerl) {
      const perlPriceUrl = `https://api.cryptowat.ch/markets/binance/perlusdt/price?apikey=${this.cryptowatchApiKey}`;
      const perlPriceResponse = await this.networker.getJson(perlPriceUrl);

      if (!perlPriceResponse || !perlPriceResponse.result || !perlPriceResponse.result.price) {
        throw new Error(
          `🚨Could not parse PERL price result from url ${perlPriceUrl}: ${JSON.stringify(perlPriceResponse)}`
        );
      }
      perlPerUsd = 1 / perlPriceResponse.result.price;
      if (perlPerUsd === 0) {
        throw new Error("🚨 PERL price should not be zero");
      }
    }

    // Return data structure:
    // {
    //     "close": 1863.21,
    //     "currency": "XAUUSD",
    //     "date_time": "2021-01-25-13:12",
    //     "endpoint": "minute_historical",
    //     "high": 1863.785,
    //     "low": 1863.02,
    //     "open": 1863.54,
    //     "request_time": "Mon, 25 Jan 2021 13:13:41 GMT"
    //  }
    const newPrice = this.convertPriceFeedDecimals(
      this.convertToPerl ? priceResponse.close * perlPerUsd : priceResponse.close
    );

    // Return data structure:
    // {
    //     "base_currency": "XAU",
    //     "end_date": "2021-01-25 10:44:00",
    //     "endpoint": "timeseries",
    //     "quote_currency": "USD",
    //     "quotes": [
    //       {
    //         "close": 1869.705,
    //         "date": "2021-01-22 00:00:00",
    //         "high": 1869.98,
    //         "low": 1869.61,
    //         "open": 1869.98
    //       },
    //       ...
    // }
    const newHistoricalPricePeriods = historyResponse.quotes.map(row => ({
      openTime: Math.floor(new Date(row.date).valueOf() / 1000 - this.periods * 60),
      closeTime: Math.floor(new Date(row.date).valueOf() / 1000),
      openPrice: this.convertPriceFeedDecimals(this.convertToPerl ? row.open * perlPerUsd : row.open),
      closePrice: this.convertPriceFeedDecimals(this.convertToPerl ? row.close * perlPerUsd : row.close)
    }));

    // 5. Store results.
    this.currentPrice = newPrice;
    this.historicalPricePeriods = newHistoricalPricePeriods;
    this.lastUpdateTime = currentTime;
  }

  _getFormattedDate(timestamp) {
    let date = new Date(timestamp * 1000);
    date.setMinutes(date.getMinutes() - 1); // Subtract one minute
    return date
      .toISOString()
      .slice(0, 16)
      .replace("Z", "")
      .replace("T", "-");
  }

  _invertPriceSafely(priceBN) {
    if (priceBN && !priceBN.isZero()) {
      return this.convertPriceFeedDecimals("1")
        .mul(this.convertPriceFeedDecimals("1"))
        .div(priceBN);
    } else {
      return undefined;
    }
  }
}

module.exports = {
  PerlinXPriceFeed
};
