const assert = require("assert");
const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BlockHistory, PriceHistory } = require("./utils");

// Gets balancer prices as well as historical prices
class BalancerPriceFeed extends PriceFeedInterface {
  constructor(logger, web3, getTime, abi, address, tokenIn, tokenOut, lookback) {
    assert(tokenIn, "BalancerPriceFeed requires tokenIn");
    assert(tokenOut, "BalancerPriceFeed requires tokenOut");
    assert(lookback, "BalancerPriceFeed requires lookback");
    super();
    this.logger = logger;
    this.web3 = web3;
    this.getTime = getTime;

    this.contract = new web3.eth.Contract(abi, address);
    this.currentPrice = null;
    this.lastUpdateTime = null;
    this.tokenIn = tokenIn;
    this.tokenOut = tokenOut;
    this.lookback = lookback;
    this.blockHistory = BlockHistory(web3);

    // Add a callback to get price, if an error is thrown returns undefined
    this.priceHistory = PriceHistory(async number => {
      try {
        const result = await this.contract.methods.getSpotPriceSansFee(this.tokenIn, this.tokenOut).call(number);
        return result;
      } catch (err) {
        this.logger.warn({
          at: "BalancerPriceFeed.getPrice",
          message: err.message,
          number
        });
      }
    });
  }
  getHistoricalPrice(time) {
    // normally would bubble up errors, but this is not supposed to throw
    try {
      const block = this.blockHistory.getClosestTime(time);
      return this.priceHistory.get(block.timestamp);
    } catch (err) {
      // this can throw an error if no price is found, but lets return null to copy uniswap price feed
      return null;
    }
  }
  getLastUpdateTime() {
    return this.lastUpdateTime;
  }
  getCurrentPrice() {
    // normally would bubble up errors, but this is not supposed to throw
    try {
      return this.priceHistory.currentPrice();
    } catch (err) {
      // this can throw an error if no current price is set, but lets return null to copy uniswap price feed
      return null;
    }
  }
  async update() {
    try {
      this.lastUpdateTime = await this.getTime();
      // its possible provider throws error getting block history
      // we are going to just ignore these errors...
      const blocks = await this.blockHistory.update(this.lookback, this.lastUpdateTime);
      await this.priceHistory.update(blocks);
    } catch (err) {
      this.logger.warn({
        at: "BalancerPriceFeed",
        message: err.message
      });
    }
  }
}

module.exports = {
  BalancerPriceFeed
};
