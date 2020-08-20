const { PriceFeedInterface } = require("./PriceFeedInterface");

// An implementation of PriceFeedInterface that medianizes other price feeds.
class PriceFeedMock extends PriceFeedInterface {
  // Constructs the MedianizerPriceFeed.
  // priceFeeds a list of priceFeeds to medianize. All elements must be of type PriceFeedInterface. Must be an array of
  // at least one element.
  constructor(currentPrice, historicalPrice, lastUpdateTime) {
    super();
    this.updateCalled = 0;
    this.currentPrice = currentPrice;
    this.historicalPrice = historicalPrice;
    this.lastUpdateTime = lastUpdateTime;
    this.historicalPrices = [];
  }

  setCurrentPrice(currentPrice) {
    this.currentPrice = currentPrice;
  }

  // Store an array of historical prices [{timestamp, price}] so that getHistoricalPrice can return
  // a price for a specific timestamp if found in this array.
  setHistoricalPrices(historicalPrices) {
    historicalPrices.forEach(_price => {
      if (isNaN(_price.timestamp)) {
        throw "Invalid historical price => [{timestamp, price}]";
      }

      this.historicalPrices[_price.timestamp] = _price.price;
    });
  }

  setHistoricalPrice(historicalPrice) {
    this.historicalPrice = historicalPrice;
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
  PriceFeedMock
};
