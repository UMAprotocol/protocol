const { PriceFeedInterface } = require("../../price-feed/PriceFeedInterface");

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
  }

  setCurrentPrice(currentPrice) {
    this.currentPrice = currentPrice;
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
