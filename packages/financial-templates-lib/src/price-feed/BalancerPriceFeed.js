const assert = require("assert");
const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BlockHistory, PriceHistory } = require("./utils");
const { parseFixed } = require("@ethersproject/bignumber");

// Gets balancer spot and historical prices. This price feed assumes that it is returning
// prices as 18 decimals of precision, so it will scale up the pool's price as reported by Balancer contracts
// if the user specifies that the Balancer contract is returning non-18 decimal precision prices.
class BalancerPriceFeed extends PriceFeedInterface {
  constructor(logger, web3, getTime, abi, address, tokenIn, tokenOut, lookback, poolDecimals = 18, decimals = 18) {
    assert(tokenIn, "BalancerPriceFeed requires tokenIn");
    assert(tokenOut, "BalancerPriceFeed requires tokenOut");
    assert(lookback >= 0, "BalancerPriceFeed requires lookback >= 0");
    super();
    this.logger = logger;
    this.web3 = web3;
    this.toBN = web3.utils.toBN;
    this.getTime = getTime;

    this.contract = new web3.eth.Contract(abi, address);
    this.currentPrice = null;
    this.lastUpdateTime = null;
    this.tokenIn = tokenIn;
    this.tokenOut = tokenOut;
    this.lookback = lookback;
    this.getLatestBlock = number => web3.eth.getBlock(number >= 0 ? number : "latest");
    // Provide a getblock function which returns the latest value if no number provided.
    this.blockHistory = BlockHistory(this.getLatestBlock);

    // Add a callback to get price, error can be thrown from web3 disconection or maybe something else
    // which affects the update call.
    this.priceHistory = PriceHistory(async number => {
      try {
        return this.toBN(await this.contract.methods.getSpotPriceSansFee(this.tokenIn, this.tokenOut).call(number));
      } catch (err) {
        // If query failed, skip;
        return null;
      }
    });

    // poolPrecision represents the # of decimals that Balancer pool prices are returned in.
    this.poolPrecision = poolDecimals;

    // Convert _bn precision from poolDecimals to desired decimals by scaling up or down based
    // on the relationship between poolPrecision and the desired decimals.
    this.convertDecimals = _bn => {
      if (this.poolPrecision < decimals) {
        return _bn.mul(this.toBN(parseFixed("1", decimals - this.poolPrecision).toString()));
      } else if (this.poolPrecision > decimals) {
        return _bn.div(this.toBN(parseFixed("1", this.poolPrecision - decimals).toString()));
      } else {
        return _bn;
      }
    };
  }
  getHistoricalPrice(time) {
    // We want the block and price equal to or before this time
    const block = this.blockHistory.getClosestBefore(time);
    if (block == null) return null;
    if (!this.priceHistory.has(block.timestamp)) {
      return null;
    }
    return this.convertDecimals(this.priceHistory.get(block.timestamp));
  }
  getLastUpdateTime() {
    return this.lastUpdateTime;
  }
  getCurrentPrice() {
    // current price can be undefined, will throw for any other errors
    return this.convertDecimals(this.priceHistory.currentPrice());
  }
  async update() {
    this.lastUpdateTime = await this.getTime();
    this.logger.debug({
      at: "BalancerPriceFeed",
      message: "Updating",
      lastUpdateTimestamp: this.lastUpdateTime
    });
    let blocks = [];
    // disabled lookback by setting it to 0
    if (this.lookback == 0) {
      // handle no lookback, we just want latest block
      const block = await this.getLatestBlock();
      this.blockHistory.insert(block);
      blocks = this.blockHistory.listBlocks();
    } else {
      // handle historical lookback. Have to be careful your lookback time gives a big enough
      // window to find a single block, otherwise you will have errors.
      blocks = await this.blockHistory.update(this.lookback, this.lastUpdateTime);
    }
    await Promise.all(blocks.map(this.priceHistory.update));
  }
}

module.exports = {
  BalancerPriceFeed
};
