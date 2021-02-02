const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@ethersproject/bignumber");

// An implementation of PriceFeedInterface that uses DominationFinance's API to retrieve prices.
class DominationFinancePriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the DominationFinancePriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Instance used for Web3 utilities and conversions.
   * @param {String} pair Representation of the pair the price feed is tracking.
   *    The string should be the representation used by the DomFi API to identify this pair.
   * @param {Integer} lookback How far in the past the historical prices will be available using await  getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the Unix timestamp in seconds.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Number} priceFeedDecimals Number of decimals to use to convert price to wei.
   * @param {Bool} invertPrice Indicates if prices should be inverted before returned.
   * @param {Number} tickPeriod Number of seconds interval between price entries.
   */
  constructor(
    logger,
    web3,
    pair,
    lookback,
    networker,
    getTime,
    minTimeBetweenUpdates,
    invertPrice,
    priceFeedDecimals = 18,
    tickPeriod = 60
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;

    this.pair = pair;
    this.lookback = lookback;
    this.uuid = `DominationFinance-${pair}`;
    this.tickPeriod = tickPeriod;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.invertPrice = invertPrice;

    this.toBN = this.web3.utils.toBN;

    this.priceFeedDecimals = priceFeedDecimals;
    this.convertPriceFeedDecimals = number => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number
      return this.toBN(parseFixed(number.toString(), priceFeedDecimals).toString());
    };
  }

  get _priceUrl() {
    return `https://api.domination.finance/api/v0/price/${this.pair}`;
  }

  get _historicalPricesUrl() {
    return `https://live.domination.finance/api/v0/history/${this.pair}?tick=${this.tickPeriod}s&range=${this.lookback}s`;
  }

  getCurrentPrice() {
    return this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
  }

  async getHistoricalPrice(time, verbose = false) {
    if (this.lastUpdateTime === undefined) {
      throw new Error(`${this.uuid}: undefined lastUpdateTime`);
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
      throw new Error(`${this.uuid}: no valid price periods`);
    }

    // If the time is before the first piece of data in the set, return null because
    // the price is before the lookback window.
    if (time < firstEntry.openTime) {
      throw new Error(`${this.uuid}: time ${time} is before firstEntry.openTime`);
    }

    // `historicalPrices` are ordered from oldest to newest.
    // Find the first entry that is after the requested timestamp
    const match = this.historicalPricePeriods.find(pricePeriod => {
      return time < pricePeriod.closeTime;
    });

    // If there is no match, that means that the time was past the last data point.
    // In this case, the best match for this price is the current price.
    let returnPrice;
    if (match === undefined) {
      returnPrice = this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
      if (verbose) {
        const priceDisplay = this.convertPriceFeedDecimals(returnPrice.toString());

        console.group(`\n(${this.pair}) No historical price available @ ${time}`);
        console.log(`- ✅ Time is later than earliest historical time, fetching current price: ${priceDisplay}`);
        console.log(
          `- ⚠️  If you want to manually verify the specific prices, you can make a GET request to: \n- ${this._priceUrl}`
        );
        console.groupEnd();
      }
      return returnPrice;
    }

    returnPrice = this.invertPrice ? this._invertPriceSafely(match.closePrice) : match.closePrice;
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
        at: "DominationFinancePriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTimes + this.minTimeBetweenUpdates - currentTime
      });
      return;
    }

    this.logger.debug({
      at: "DominationFinancePriceFeed",
      message: "Updating",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // 1. Construct URLs.
    // See https://api.domination.finance/ additional API documentation.
    const priceUrl = this._priceUrl;
    const historyUrl = this._historicalPricesUrl;

    // 2. Send requests.
    const [priceResponse, historyResponse] = await Promise.all([
      this.networker.getJson(priceUrl),
      this.networker.getJson(historyUrl)
    ]);

    // 2. Check responses.
    if (!priceResponse || typeof priceResponse.price !== "string" || priceResponse.price.length === 0) {
      throw new Error(`🚨Could not parse price result from url ${historyUrl}: ${JSON.stringify(priceResponse)}`);
    }

    if (
      !historyResponse ||
      !historyResponse.data ||
      !historyResponse.data.rows ||
      !Array.isArray(historyResponse.data.rows)
    ) {
      throw new Error(`🚨Could not parse history result from url ${historyUrl}: ${JSON.stringify(historyResponse)}`);
    }

    // 3. Parse results.
    // Return data structure:
    // {
    //   "status": "success",
    //   "price": "67.22",
    //   "timestamp": 1609870472,
    //   ...
    // }
    const newPrice = this.convertPriceFeedDecimals(priceResponse.price);

    // Return data structure:
    // {
    //   "status": "success",
    //   "data": {
    //     "asset": { ... },
    //     "rows": [
    //       [ 1609612800, "71.44" ],
    //       [ 1609612860, "71.11" ],
    //       ...
    //     ]
    //   },
    //   ...
    // }

    // Use `closeTime` and `closePrice` to maintain the same format that is
    // expected by `MedianizerPriceFeed`
    const newHistoricalPricePeriods = historyResponse.data.rows
      .map(row => ({
        openTime: row[0],
        closeTime: row[0] + this.tickPeriod,
        closePrice: this.convertPriceFeedDecimals(row[1])
      }))
      .sort((a, b) => {
        // Sorts the data such that the oldest elements come first.
        // Should already be the case, but ensures otherwise.
        return a.time - b.time;
      });

    // 5. Store results.
    this.currentPrice = newPrice;
    this.historicalPricePeriods = newHistoricalPricePeriods;
    this.lastUpdateTime = currentTime;
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
  DominationFinancePriceFeed
};
