const { PriceFeedInterface } = require("./PriceFeedInterface");

// An implementation of PriceFeedInterface that uses CryptoWatch to retrieve prices.
class CryptoWatchPriceFeed extends PriceFeedInterface {
  // Constructs the CryptoWatchPriceFeed.
  // apiKey the CW API key. Note: these API keys are rate-limited.
  // exchange a string identifier for the echange to pull prices from. This should be the identifier used to
  //          identify the exchange in CW's REST API.
  // pair a string representation of the pair the price feed is tracking. This pair should be available on the
  //      provided exchange. The string should be the representation used by CW to identify this pair.
  // lookback how far in the past the historical prices will be available using the getHistoricalPrice function.
  // networker networker object used to send the API requests.
  // getTime function to return the current time.
  // minTimeBetweenUpdates min number of seconds between updates. If update() is called again before this number of
  // seconds has passed, it will be a no-op.
  constructor(web3, logger, apiKey, exchange, pair, lookback, networker, getTime, minTimeBetweenUpdates) {
    super();
    this.web3 = web3;
    this.logger = logger;
    this.apiKey = apiKey;
    this.exchange = exchange;
    this.pair = pair;
    this.lookback = lookback;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;

    // Use CryptoWatch's most granular option, one minute.
    this.ohlcPeriod = 60;
  }

  getCurrentPrice() {
    return this.currentPrice;
  }

  getHistoricalPrice(time) {
    if (this.lastUpdateTime === undefined) {
      return undefined;
    }

    // If the time is before the first piece of data in the set, return null because the price is before the lookback
    // window.
    if (time < this.historicalPricePeriods[0].openTime) {
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
      return this.currentPrice;
    }

    return match.openPrice;
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  async update() {
    const { toWei, toBN } = this.web3.utils;
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
      `https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/ohlc?`,
      `afer=${earliestHistoricalTimestamp}&`,
      `periods=${this.ohlcPeriod}&`,
      `apikey=${this.apiKey}`
    ].join("");

    const ohlcResponse = await this.networker.getJson(ohlcUrl);
    if (!ohlcResponse || !ohlcResponse.result || !ohlcResponse.result[this.ohlcPeriod]) {
      console.error("Could not parse ohlc result:", ohlcResponse);
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
        openPrice: toBN(toWei(ohlc[1].toString())),
        closePrice: toBN(toWei(ohlc[4].toString()))
      }))
      .sort((a, b) => {
        // Sorts the data such that the oldest elements come first.
        return a.openTime - b.openTime;
      });

    // See https://docs.cryptowat.ch/rest-api/markets/price for how this url is constructed.
    const priceUrl = `https://api.cryptowat.ch/markets/${this.exchange}/${this.pair}/price?apikey=${this.apikey}`;
    const priceResponse = await this.networker.getJson(priceUrl);
    if (!ohlcResponse || !priceResponse.result || !priceResponse.result.price) {
      console.error("Could not parse price result:", priceResponse);
      return;
    }

    // Return data structure:
    // {
    //   "result": {
    //     "price": priceValue
    //   }
    // }
    this.currentPrice = toBN(toWei(priceResponse.result.price.toString()));

    this.historicalPricePeriods = newHistoricalPricePeriods;
    this.lastUpdateTime = currentTime;
  }
}

module.exports = {
  CryptoWatchPriceFeed
};
