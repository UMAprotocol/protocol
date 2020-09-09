const { toBN } = require("web3").utils;
const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@ethersproject/bignumber");

// An implementation of PriceFeedInterface that medianizes other price feeds.
class PriceFeedMockScaled extends PriceFeedInterface {
  // Constructs the MedianizerPriceFeed.
  // priceFeeds a list of priceFeeds to medianize. All elements must be of type PriceFeedInterface. Must be an array of
  // at least one element.
  constructor(currentPrice, historicalPrice, lastUpdateTime, invertPrice, decimals = 18) {
    super();
    this.updateCalled = 0;
    this.currentPrice = currentPrice;
    this.historicalPrice = historicalPrice;
    this.lastUpdateTime = lastUpdateTime;
    this.historicalPrices = [];
    this.invertPrice = invertPrice;

    this.convertDecimals = number => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number
      return toBN(parseFixed(number.toString(), decimals).toString());
    };
  }

  // only available in mock
  // this will convert to correct "wei" representation based on decimals in constructor
  setCurrentPrice(currentPrice) {
    // allows this to be set to null without throwing
    this.currentPrice = currentPrice ? this.convertDecimals(currentPrice) : currentPrice;
  }

  // only available in mock
  // Store an array of historical prices [{timestamp, price}] so that getHistoricalPrice can return
  // a price for a specific timestamp if found in this array.
  // this will convert to correct "wei" representation based on decimals in constructor
  setHistoricalPrices(historicalPrices) {
    historicalPrices.forEach(_price => {
      if (isNaN(_price.timestamp)) {
        throw "Invalid historical price => [{timestamp, price}]";
      }

      this.historicalPrices[_price.timestamp] = this.convertDecimals(_price.price);
    });
  }

  // only available in mock
  setHistoricalPrice(historicalPrice) {
    this.historicalPrice = this.convertDecimals(historicalPrice);
  }

  setLastUpdateTime(lastUpdateTime) {
    this.lastUpdateTime = lastUpdateTime;
  }

  getCurrentPrice() {
    return this.currentPrice;
  }

  getHistoricalPrice(time) {
    // If a price for `time` was set via `setHistoricalPrices`, then return that price, otherwise return the mocked
    // historical price.
    if (time in this.historicalPrices) {
      return this.historicalPrices[time];
    }
    return this.historicalPrice;
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  async update() {
    this.updateCalled++;
  }
}

module.exports = {
  PriceFeedMockScaled
};
