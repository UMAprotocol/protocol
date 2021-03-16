const { PriceFeedInterface } = require("./PriceFeedInterface");

// Simulates a pricefeed with bad data
class InvalidPriceFeedMock extends PriceFeedInterface {
  constructor(logger, web3, getTime, decimals = 18) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.getTime = getTime;

    this.currentPrice = null;
    this.lastUpdateTime = null;
    this.priceFeedDecimals = decimals;
  }
  async getHistoricalPrice() {
    throw new Error("InvalidPriceFeedMock: expected missing historical price");
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
  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }
  async update() {
    throw new Error("InvalidPriceFeedMock: expected update failure");
  }
}

module.exports = {
  InvalidPriceFeedMock
};
