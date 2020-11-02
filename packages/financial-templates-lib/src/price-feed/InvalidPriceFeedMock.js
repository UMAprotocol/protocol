const { PriceFeedInterface } = require("./PriceFeedInterface");

// Simulates a pricefeed with bad data
class InvalidPriceFeedMock extends PriceFeedInterface {
  constructor(logger, web3, getTime) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.getTime = getTime;

    this.currentPrice = null;
    this.lastUpdateTime = null;
  }
  getHistoricalPrice() {
    return null;
  }
  getLastUpdateTime() {
    return this.lastUpdateTime;
  }
  setLastUpdateTime(lastUpdateTime) {
    this.lastUpdateTime = lastUpdateTime;
  }
  getCurrentPrice() {
    return null;
  }
  async update() {
    return;
  }
}

module.exports = {
  InvalidPriceFeedMock
};
