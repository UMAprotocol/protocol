const assert = require("assert");
const { PriceFeedInterface } = require("./PriceFeedInterface");

class BalancerPriceFeed extends PriceFeedInterface {
  constructor(logger, web3, getTime, abi, address, tokenIn, tokenOut) {
    assert(tokenIn, "BalancerPriceFeed requires tokenIn");
    assert(tokenOut, "BalancerPriceFeed requires tokenOut");
    super();
    this.logger = logger;
    this.web3 = web3;
    this.getTime = getTime;

    this.contract = new web3.eth.Contract(abi, address);
    this.currentPrice = null;
    this.lastUpdateTime = null;
    this.tokenIn = tokenIn;
    this.tokenOut = tokenOut;
  }
  getHistoricalPrice(time) {
    throw new Error("getHistoricalPrice not implemented for BalancerPriceFeed");
  }
  getLastUpdateTime() {
    return this.lastUpdateTime;
  }
  getCurrentPrice() {
    return this.currentPrice;
  }
  async update() {
    this.currentPrice = await this.contract.methods.getSpotPriceSansFee(this.tokenIn, this.tokenOut).call();
    this.lastUpdateTime = await this.getTime();
  }
}

module.exports = {
  BalancerPriceFeed
};
