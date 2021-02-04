const { PriceFeedInterface } = require("./PriceFeedInterface");
const { toBN } = require("web3").utils;

// An implementation of PriceFeedInterface that medianizes other price feeds.
class PriceFeedMock extends PriceFeedInterface {
  // Constructs the MedianizerPriceFeed.
  // priceFeeds a list of priceFeeds to medianize. All elements must be of type PriceFeedInterface. Must be an array of
  // at least one element. Note that no decimals are included in this price feed. It simply stores the exact input number
  // provided by the test suite. Therefore, decimal conversion is expected to occur within the tests themselves.
  constructor(currentPrice, historicalPrice, lastUpdateTime, priceFeedDecimals = 18, lookback = 3600) {
    super();
    this.updateCalled = 0;
    this.currentPrice = currentPrice;
    this.historicalPrice = historicalPrice;
    this.lastUpdateTime = lastUpdateTime;
    this.priceFeedDecimals = priceFeedDecimals;
    this.historicalPrices = [];
    this.lookback = lookback;
    this.uuid = "PriceFeedMock";
  }

  setCurrentPrice(currentPrice) {
    // allows this to be set to null without throwing.
    this.currentPrice = currentPrice ? toBN(currentPrice) : currentPrice;
  }

  // Store an array of historical prices [{timestamp, price}] so that await  getHistoricalPrice can return
  // a price for a specific timestamp if found in this array.
  setHistoricalPrices(historicalPrices) {
    historicalPrices.forEach(_price => {
      if (isNaN(_price.timestamp)) {
        throw "Invalid historical price => [{timestamp, price}]";
      }
      // allows this to be set to null without throwing.
      this.historicalPrices[_price.timestamp] = _price.price ? toBN(_price.price) : _price.price;
    });
  }

  setHistoricalPrice(historicalPrice) {
    this.historicalPrice = historicalPrice;
  }

  setLastUpdateTime(lastUpdateTime) {
    this.lastUpdateTime = lastUpdateTime;
  }

  setLookback(lookback) {
    this.lookback = lookback;
  }

  getCurrentPrice() {
    return this.currentPrice;
  }

  async getHistoricalPrice(time) {
    // To implement the PriceFeedInterface properly, this method must either return a valid price
    // or throw.
    if (!this.historicalPrice && !(time in this.historicalPrices)) {
      throw new Error("PriceFeedMock expected error thrown");
    } else {
      // If a price for `time` was set via `setHistoricalPrices`, then return that price, otherwise return the mocked
      // historical price.
      if (time in this.historicalPrices) {
        return this.historicalPrices[time];
      } else {
        return this.historicalPrice;
      }
    }
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
    this.updateCalled++;
  }
}

module.exports = {
  PriceFeedMock
};
