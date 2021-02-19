const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@uma/common");

// An implementation of PriceFeedInterface that uses CryptoWatch to retrieve prices.
class CryptoWatchPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the CryptoWatchPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String} apiKey optional CW API key. Note: these API keys are rate-limited.
   * @param {String} exchange Identifier for the exchange to pull prices from. This should be the identifier used by the
   *      exchange in CW's REST API.
   * @param {String} pair Representation of the pair the price feed is tracking. This pair should be available on the
   *      provided exchange. The string should be the representation used by CW to identify this pair.
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Bool} invertPrice Indicates if prices should be inverted before returned.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   * @param {Number} ohlcPeriod Number of seconds interval between ohlc prices requested from cryptowatch.
   */
  constructor(
    logger,
    web3,
    apiKey,
    exchange,
    pair,
    lookback,
    networker,
    getTime,
    minTimeBetweenUpdates,
    invertPrice,
    priceFeedDecimals = 18,
    ohlcPeriod = 60 // One minute is CryptoWatch's most granular option.
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;

    this.apiKey = apiKey;
    this.exchange = exchange;
    this.pair = pair;
    this.lookback = lookback;
    this.uuid = `CryptoWatch-${exchange}-${pair}`;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.priceFeedDecimals = priceFeedDecimals;
    this.invertPrice = invertPrice;

    this.toBN = this.web3.utils.toBN;

    this.ohlcPeriod = ohlcPeriod;

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
      returnPrice = this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
      if (verbose) {
        console.group(`\n(${this.exchange}:${this.pair}) No OHLC available @ ${time}`);
        console.log(
          `- ✅ Time is later than earliest historical time, fetching current price: ${this.web3.utils.fromWei(
            returnPrice.toString()
          )}`
        );
        console.log(
          `- ⚠️  If you want to manually verify the specific exchange prices, you can make a GET request to: \n- https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/price`
        );
        console.groupEnd();
      }
      return returnPrice;
    }

    returnPrice = this.invertPrice ? this._invertPriceSafely(match.openPrice) : match.openPrice;
    if (verbose) {
      console.group(`\n(${this.exchange}:${this.pair}) Historical OHLC @ ${match.closeTime}`);
      console.log(`- ✅ Open Price:${this.web3.utils.fromWei(returnPrice.toString())}`);
      console.log(
        `- ⚠️  If you want to manually verify the specific exchange prices, you can make a GET request to: \n- https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/ohlc?after=${match.closeTime}&before=${match.closeTime}&periods=60`
      );
      console.log(
        '- This will return an OHLC data packet as "result", which contains in order: \n- [CloseTime, OpenPrice, HighPrice, LowPrice, ClosePrice, Volume, QuoteVolume].'
      );
      console.log(
        "- We use the OpenPrice to compute the median. Note that you might need to invert the prices for certain identifiers like USDETH."
      );
      console.groupEnd();
    }
    return returnPrice;
  }

  getHistoricalPricePeriods() {
    if (!this.invertPrice)
      return this.historicalPricePeriods.map(historicalPrice => {
        return [historicalPrice.closeTime, historicalPrice.closePrice];
      });
    else
      return this.historicalPricePeriods.map(historicalPrice => {
        return [historicalPrice.closeTime, this._invertPriceSafely(historicalPrice.closePrice)];
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
        at: "CryptoWatchPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTimes + this.minTimeBetweenUpdates - currentTime
      });
      return;
    }

    this.logger.debug({
      at: "CryptoWatchPriceFeed",
      message: "Updating CryptoWatchPriceFeed",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // Round down to the nearest ohlc period so the queries captures the OHLC of the period *before* this earliest
    // timestamp (because the close of that OHLC may be relevant).
    const earliestHistoricalTimestamp = Math.floor((currentTime - this.lookback) / this.ohlcPeriod) * this.ohlcPeriod;

    // 1. Construct URLs.
    // See https://docs.cryptowat.ch/rest-api/markets/price for how this url is constructed.
    const priceUrl =
      `https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/price` +
      (this.apiKey ? `?apikey=${this.apiKey}` : "");

    // See https://docs.cryptowat.ch/rest-api/markets/ohlc for how this url is constructed.
    const ohlcUrl = [
      `https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/ohlc`,
      `?before=${currentTime}`,
      `&after=${earliestHistoricalTimestamp}`,
      `&periods=${this.ohlcPeriod}`,
      this.apiKey ? `&apikey=${this.apiKey}` : ""
    ].join("");

    // 2. Send requests.
    const [ohlcResponse, priceResponse] = await Promise.all([
      this.networker.getJson(ohlcUrl),
      this.networker.getJson(priceUrl)
    ]);

    // 3. Check responses.
    if (!priceResponse || !priceResponse.result || !priceResponse.result.price) {
      throw new Error(`🚨Could not parse price result from url ${priceUrl}: ${JSON.stringify(priceResponse)}`);
    }

    if (!ohlcResponse || !ohlcResponse.result || !ohlcResponse.result[this.ohlcPeriod]) {
      throw new Error(`🚨Could not parse ohlc result from url ${ohlcUrl}: ${JSON.stringify(ohlcResponse)}`);
    }

    // 4. Parse results.
    // Return data structure:
    // {
    //   "result": {
    //     "price": priceValue
    //   }
    // }
    const newPrice = this.convertPriceFeedDecimals(priceResponse.result.price);

    // Return data structure:
    // {
    //   "result": {
    //     "OhlcInterval": [
    //     [
    //       CloseTime,
    //       OpenPrice,
    //       HighPrice,
    //       LowPrice,
    //       ClosePrice,
    //       Volume,
    //       QuoteVolume
    //     ],
    //     ...
    //     ]
    //   }
    // }
    // For more info, see: https://docs.cryptowat.ch/rest-api/markets/ohlc
    const newHistoricalPricePeriods = ohlcResponse.result[this.ohlcPeriod.toString()]
      .map(ohlc => ({
        // Output data should be a list of objects with only the open and close times and prices.
        openTime: ohlc[0] - this.ohlcPeriod,
        closeTime: ohlc[0],
        openPrice: this.convertPriceFeedDecimals(ohlc[1]),
        closePrice: this.convertPriceFeedDecimals(ohlc[4])
      }))
      .sort((a, b) => {
        // Sorts the data such that the oldest elements come first.
        return a.openTime - b.openTime;
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
  CryptoWatchPriceFeed
};
