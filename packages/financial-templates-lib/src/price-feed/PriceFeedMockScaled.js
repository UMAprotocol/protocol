const { toBN } = require("web3").utils;
const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@ethersproject/bignumber");

// Adds a final precision conversion step to the PriceFeedMock before returning prices.
class PriceFeedMockScaled extends PriceFeedInterface {
  constructor(currentPrice, historicalPrice, lastUpdateTime, priceFeedDecimals = 18, lookback = 3600) {
    super();
    this.updateCalled = 0;
    this.lastUpdateTime = lastUpdateTime;
    this.priceFeedDecimals = priceFeedDecimals;
    this.historicalPrices = [];
    this.lookback = lookback;
    this.uuid = "PriceFeedMockScaled";

    this.convertDecimals = number => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number
      return toBN(parseFixed(number.toString(), priceFeedDecimals).toString());
    };

    // Initialize state prices using specified precision
    this.setCurrentPrice(currentPrice);
    this.setHistoricalPrice(historicalPrice);
  }

  setCurrentPrice(currentPrice) {
    // allows this to be set to null without throwing.
    this.currentPrice = currentPrice ? this.convertDecimals(currentPrice) : currentPrice;
  }

  // Store an array of historical prices [{timestamp, price}] so that await  getHistoricalPrice can return
  // a price for a specific timestamp if found in this array.
  setHistoricalPrices(historicalPrices) {
    historicalPrices.forEach(_price => {
      if (isNaN(_price.timestamp)) {
        throw "Invalid historical price => [{timestamp, price}]";
      }
      // allows this to be set to null without throwing.
      this.historicalPrices[_price.timestamp] = _price.price ? this.convertDecimals(_price.price) : _price.price;
    });
  }

  setHistoricalPrice(historicalPrice) {
    this.historicalPrice = historicalPrice ? this.convertDecimals(historicalPrice) : historicalPrice;
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
  PriceFeedMockScaled
};
