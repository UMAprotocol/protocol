const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@uma/common");
const moment = require("moment-timezone");
const assert = require("assert");

// An implementation of PriceFeedInterface that uses https://api.exchangeratesapi.io/ to
// daily forex prices published by the ECB
class ForexDailyPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the CryptoWatchPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String} base The API defines the base as the three character symbol that the
   *                 exchange rate is returning the price of, quoted in the symbol.
   *                 e.g. "base=EUR&symbol=USD" EUR priced in USD terms.
   * @param {String} symbol See above explanation for `base`.
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *        this number of seconds has passed, it will be a no-op.
   */
  constructor(
    logger,
    web3,
    base,
    symbol,
    lookback,
    networker,
    getTime,
    priceFeedDecimals = 18,
    minTimeBetweenUpdates = 43200
    // 12 hours is a reasonable default since this pricefeed returns daily granularity at best.
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.base = base.toUpperCase();
    this.symbol = symbol.toUpperCase();

    assert(VALID_SYMBOLS.includes(this.base), "invalid base");
    assert(VALID_SYMBOLS.includes(this.symbol), "invalid symbol");
    this.uuid = `ForexDaily-${symbol}-${base}`;
    this.lookback = lookback;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.networker = networker;
    this.getTime = getTime;
    this.priceFeedDecimals = priceFeedDecimals;

    this.toBN = this.web3.utils.toBN;

    this.convertPriceFeedDecimals = number => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number.
      // Note: Must ensure that `number` has no more decimal places than `priceFeedDecimals`.
      return this.toBN(parseFixed(number.toString().substring(0, priceFeedDecimals), priceFeedDecimals).toString());
    };
  }

  getCurrentPrice() {
    return this.currentPrice;
  }

  async getHistoricalPrice(time, verbose = false) {
    if (this.lastUpdateTime === undefined) {
      throw new Error(`${this.uuid}: undefined lastUpdateTime`);
    }

    // Set first price period in `historicalPricePeriods` to first non-null price.
    let firstPricePeriod;
    for (let p in this.historicalPricePeriods) {
      if (this.historicalPricePeriods[p] && this.historicalPricePeriods[p].openTime) {
        firstPricePeriod = this.historicalPricePeriods[p];
        break;
      }
    }

    // If there are no valid price periods, return null.
    if (!firstPricePeriod) {
      throw new Error(`${this.uuid}: no valid price periods`);
    }

    // If the time is before the first piece of data in the set, return null because
    // the price is before the lookback window.
    if (time < firstPricePeriod.openTime) {
      throw new Error(`${this.uuid}: time ${time} is before firstPricePeriod.openTime`);
    }

    // historicalPricePeriods are ordered from oldest to newest.
    // This finds the first pricePeriod whose closeTime is after the provided time.
    const match = this.historicalPricePeriods.find(pricePeriod => {
      return time < pricePeriod.closeTime;
    });

    // If there is no match, that means that the time was past the last data point.
    // In this case, the best match for this price is the current price.
    let returnPrice;
    if (match === undefined) {
      returnPrice = this.currentPrice;
      if (verbose) {
        console.group(`\n(${this.symbol}${this.base}) No daily price available @ ${time}`);
        console.log(
          `- ✅ Time is later than earliest historical time, fetching current price: ${this.web3.utils.fromWei(
            returnPrice.toString()
          )}`
        );
        console.log(
          `- ⚠️  If you want to manually verify the specific exchange prices, you can make a GET request to: \n- https://exchangeratesapi.io/history?base=${this.base}&symbols=${this.symbol}`
        );
        console.groupEnd();
      }
      return returnPrice;
    }

    returnPrice = match.closePrice;
    if (verbose) {
      console.group(`\n(${this.symbol}${this.base}) Historical Daily Price @ ${match.closeTime}`);
      console.log(`- ✅ Close Price:${this.web3.utils.fromWei(returnPrice.toString())}`);
      console.log(
        `- ⚠️  If you want to manually verify the specific exchange prices, you can make a GET request to: \n- https://exchangeratesapi.io/history?base=${this.base}&symbols=${this.symbol}`
      );
      console.groupEnd();
    }
    return returnPrice;
  }

  getHistoricalPricePeriods() {
    return this.historicalPricePeriods.map(historicalPrice => {
      return [historicalPrice.closeTime, historicalPrice.closePrice];
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
        at: "ForexDailyPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTimes + this.minTimeBetweenUpdates - currentTime
      });
      return;
    }

    this.logger.debug({
      at: "ForexDailyPriceFeed",
      message: "Updating ForexDailyPriceFeed",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // Find the closest day that completed before the beginning of the lookback window, and use
    // it as the start date.
    const startLookbackWindow = currentTime - this.lookback;
    const startDateString = this._secondToDateTime(startLookbackWindow);
    const endDateString = this._secondToDateTime(currentTime);

    // 1. Construct URL.
    // See https://exchangeratesapi.io/ for how this url is constructed.
    const url = [
      "https://api.exchangeratesapi.io/history?",
      `start_at=${startDateString}&end_at=${endDateString}`,
      `&base=${this.base}&symbols=${this.symbol}`
    ].join("");

    // 2. Send request.
    const historyResponse = await this.networker.getJson(url);

    // 3. Check responses.
    if (
      !historyResponse?.rates ||
      Object.keys(historyResponse.rates).length === 0 ||
      Object.values(historyResponse.rates).some(rate => !rate[this.symbol])
    ) {
      throw new Error(`🚨Could not parse price result from url ${url}: ${JSON.stringify(historyResponse)}`);
    }

    // 4. Parse results.
    // Return data structure:
    // {
    //   "rates": {
    //     "2021-03-16": {"EUR":0.8385041087},
    //     "2021-03-15": {"EUR":0.8389261745},
    //   },
    //     "start_at": "2021-03-15",
    //     "end_at": "2021-03-16",
    //     "base": "USD"
    // }
    const newHistoricalPricePeriods = Object.keys(historyResponse.rates)
      .map(dateString => ({
        // Output data should be a list of objects with only the open and close times and prices.
        openTime: this._dateTimeToSecond(dateString) - 24 * 3600,
        closeTime: this._dateTimeToSecond(dateString),
        closePrice: this.convertPriceFeedDecimals(historyResponse.rates[dateString][this.symbol])
      }))
      .sort((a, b) => {
        // Sorts the data such that the oldest elements come first.
        return a.openTime - b.openTime;
      });

    // 5. Store results.
    this.currentPrice = newHistoricalPricePeriods[newHistoricalPricePeriods.length - 1].closePrice;
    this.historicalPricePeriods = newHistoricalPricePeriods;
    this.lastUpdateTime = currentTime;
  }

  // ECB data is published every day at 16:00 CET (UTC+1).
  _secondToDateTime(inputSecond) {
    // To convert from unix to date string, first we convert to CET and then we subtract 16 hours since
    // the ECB "begins" days at 16:00 CET. This reverses the calculation performed in `_dateTimeToSecond`.
    return moment
      .unix(inputSecond)
      .tz("Europe/Berlin")
      .subtract(16, "hours")
      .format("YYYY-MM-DD");
  }
  _dateTimeToSecond(inputDateTime) {
    // To convert from date string to unix, we assume that the date string
    // denotes CET time, and then we add 16 hours since the ECB "begins" days at 16:00 CET..
    return moment
      .tz(inputDateTime, "YYYY-MM-DD", "Europe/Berlin")
      .add(16, "hours")
      .unix();
  }
}

// Base and Symbol are drawn from the same list:
const VALID_SYMBOLS = [
  "CAD",
  "HKD",
  "ISK",
  "PHP",
  "DKK",
  "HUF",
  "CZK",
  "AUD",
  "RON",
  "SEK",
  "IDR",
  "INR",
  "BRL",
  "RUB",
  "HRK",
  "JPY",
  "THB",
  "CHF",
  "SGD",
  "PLN",
  "BGN",
  "TRY",
  "CNY",
  "NOK",
  "NZD",
  "ZAR",
  "USD",
  "MXN",
  "ILS",
  "GBP",
  "KRW",
  "MYR",
  "EUR"
];

module.exports = {
  ForexDailyPriceFeed
};
