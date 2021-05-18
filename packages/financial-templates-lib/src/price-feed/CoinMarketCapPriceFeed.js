const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@uma/common");

class CoinMarketCapPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the CoinMarketCapPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {String} apiKey CoinMarketCap API key.
   * @param {String} symbol Cryptocurrency symbol. Example: BTC, ETH, DAI
   * @param {String} quoteCurrency Currency to use for calculating market quote. Example: PHP, USD
   * @param {Integer} lookback How far in the past the historical prices will be available using getHistoricalPrice.
   * @param {Object} networker Used to send the API requests.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Min number of seconds between updates. If update() is called again before
   *      this number of seconds has passed, it will be a no-op.
   * @param {Bool} invertPrice Indicates if prices should be inverted before returned.
   * @param {Number} priceFeedDecimals Number of priceFeedDecimals to use to convert price to wei.
   */
  constructor(
    logger,
    web3,
    apiKey,
    symbol,
    quoteCurrency,
    lookback,
    networker,
    getTime,
    minTimeBetweenUpdates,
    invertPrice,
    priceFeedDecimals = 18
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.apiKey = apiKey;
    this.symbol = symbol;
    this.quoteCurrency = quoteCurrency;
    this.lookback = lookback;
    this.uuid = `CoinMarketCap-${symbol}-${quoteCurrency}`;
    this.networker = networker;
    this.getTime = getTime;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.invertPrice = invertPrice;
    this.priceFeedDecimals = priceFeedDecimals;

    this.priceHistory = []; // array of { time: number, price: BN }

    this.convertPriceFeedDecimals = (number) => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number.
      // Note: Must ensure that `number` has no more decimal places than `priceFeedDecimals`.
      return this.web3.utils.toBN(
        parseFixed(number.toString().substring(0, priceFeedDecimals), priceFeedDecimals).toString()
      );
    };
  }

  async update() {
    const currentTime = this.getTime();

    // Return early if the last call was too recent.
    if (this.lastUpdateTime !== undefined && this.lastUpdateTime + this.minTimeBetweenUpdates > currentTime) {
      this.logger.debug({
        at: "CoinMarketCapPriceFeed",
        message: "Update skipped because the last one was too recent",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTime,
        timeRemainingUntilUpdate: this.lastUpdateTimes + this.minTimeBetweenUpdates - currentTime,
      });
      return;
    }

    this.logger.debug({
      at: "CoinMarketCapPriceFeed",
      message: "Updating CoinMarketCapPriceFeed",
      currentTime: currentTime,
      lastUpdateTimestamp: this.lastUpdateTime,
    });

    // 1. Construct URL.
    // See https://coinmarketcap.com/api/documentation/v1/#operation/getV1CryptocurrencyQuotesLatest for how this url is constructed.
    const url =
      "https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?" +
      `symbol=${this.symbol}&convert=${this.quoteCurrency}` +
      (this.apiKey ? `&CMC_PRO_API_KEY=${this.apiKey}` : "");

    // 2. Send request.
    const response = await this.networker.getJson(url);

    // 3. Check response.
    if (
      !response ||
      !response.data ||
      !response.data[this.symbol] ||
      !response.data[this.symbol].quote[this.quoteCurrency]
    ) {
      throw new Error(`🚨Could not parse result from url ${url}: ${JSON.stringify(response)}`);
    }

    // 4. Parse result.
    // Return data structure:
    // {
    //   "data": {
    //     "<symbol>": {
    //       quote: {
    //         "<convert>": {
    //           "price": "<price>"
    //         }
    //       }
    //     }
    //   }
    // }
    const newPrice = this.convertPriceFeedDecimals(response.data[this.symbol].quote[this.quoteCurrency].price);

    // 5. Store results.
    this.currentPrice = newPrice;
    this.lastUpdateTime = currentTime;
    this.priceHistory.push({ time: currentTime, price: newPrice });
  }

  getCurrentPrice() {
    return this.invertPrice ? this._invertPriceSafely(this.currentPrice) : this.currentPrice;
  }

  async getHistoricalPrice(time) {
    if (this.lastUpdateTime === undefined) {
      throw new Error(`${this.uuid}: undefined lastUpdateTime`);
    }

    let matchingPrice;
    for (const history of this.priceHistory) {
      const minTime = history.time - this.lookback;
      const maxTime = history.time;

      if (time >= minTime && time <= maxTime) {
        matchingPrice = history.price;
        break;
      }
    }

    if (!matchingPrice) {
      throw new Error(`${this.uuid}: no matching price`);
    }

    return this.invertPrice ? this._invertPriceSafely(matchingPrice) : matchingPrice;
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }

  getLookback() {
    return this.lookback;
  }

  _invertPriceSafely(priceBN) {
    if (priceBN && !priceBN.isZero()) {
      return this.convertPriceFeedDecimals("1").mul(this.convertPriceFeedDecimals("1")).div(priceBN);
    } else {
      return undefined;
    }
  }
}

module.exports = {
  CoinMarketCapPriceFeed,
};
