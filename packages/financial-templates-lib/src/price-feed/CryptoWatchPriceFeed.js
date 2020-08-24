const { PriceFeedInterface } = require("./PriceFeedInterface");
const { ConvertDecimals } = require("@umaprotocol/common");
const { parseFixed } = require("@ethersproject/bignumber");

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
    decimals = 18
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;

    this.apiKey = apiKey;
    this.exchange = exchange;
    this.pair = pair;
    this.lookback = lookback;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.invertPrice = invertPrice;

    // Use CryptoWatch's most granular option, one minute.
    this.ohlcPeriod = 60;

    this.convertDecimals = number => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number
      return parseFixed(number.toString(), decimals);
    };
  }

  getCurrentPrice() {
    return this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
  }

  getHistoricalPrice(time) {
    if (this.lastUpdateTime === undefined) {
      return undefined;
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
      return null;
    }

    // If the time is before the first piece of data in the set, return null because
    // the price is before the lookback window.
    if (time < firstPricePeriod.openTime) {
      return null;
    }

    // historicalPricePeriods are ordered from oldest to newest.
    // This finds the first pricePeriod whose closeTime is after the provided time.
    const match = this.historicalPricePeriods.find(pricePeriod => {
      return time < pricePeriod.closeTime;
    });

    // If there is no match, that means that the time was past the last data point.
    // In this case, the best match for this price is the current price.
    if (match === undefined) {
      return this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
    }

    return this.invertPrice ? this._invertPriceSafely(match.openPrice) : match.openPrice;
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
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
      message: "Updating",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime
    });

    // Round down to the nearest ohlc period so the queries captures the OHLC of the period *before* this earliest
    // timestamp (because the close of that OHLC may be relevant).
    const earliestHistoricalTimestamp = Math.floor((currentTime - this.lookback) / this.ohlcPeriod) * this.ohlcPeriod;

    // See https://docs.cryptowat.ch/rest-api/markets/ohlc for how this url is constructed.
    const ohlcUrl = [
      `https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/ohlc`,
      `?after=${earliestHistoricalTimestamp}`,
      `&periods=${this.ohlcPeriod}`,
      this.apiKey ? `&apiKey=${this.apiKey}` : ""
    ].join("");

    const ohlcResponse = await this.networker.getJson(ohlcUrl);
    if (!ohlcResponse || !ohlcResponse.result || !ohlcResponse.result[this.ohlcPeriod]) {
      this.logger.error({
        at: "CryptoWatchPriceFeed",
        message: "Could not parse ohlc result🚨",
        error: new Error(JSON.stringify(ohlcResponse))
      });
      return;
    }

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
        openPrice: this.convertDecimals(ohlc[1]),
        closePrice: this.convertDecimals(ohlc[4])
      }))
      .sort((a, b) => {
        // Sorts the data such that the oldest elements come first.
        return a.openTime - b.openTime;
      });

    // See https://docs.cryptowat.ch/rest-api/markets/price for how this url is constructed.
    const priceUrl =
      `https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/price` +
      (this.apiKey ? `?apiKey=${this.apiKey}` : "");
    const priceResponse = await this.networker.getJson(priceUrl);
    if (!ohlcResponse || !priceResponse.result || !priceResponse.result.price) {
      this.logger.error({
        at: "CryptoWatchPriceFeed",
        message: "Could not parse price result🚨",
        priceUrl,
        error: new Error(JSON.stringify(priceResponse))
      });
      return;
    }

    // Return data structure:
    // {
    //   "result": {
    //     "price": priceValue
    //   }
    // }
    this.currentPrice = this.convertDecimals(priceResponse.result.price);

    this.historicalPricePeriods = newHistoricalPricePeriods;
    this.lastUpdateTime = currentTime;
  }

  _invertPriceSafely(priceBN) {
    if (priceBN && !priceBN.isZero()) {
      return this.convertDecimals("1")
        .mul(this.convertDecimals("1"))
        .div(priceBN);
    } else {
      return undefined;
    }
  }
}

module.exports = {
  CryptoWatchPriceFeed
};
