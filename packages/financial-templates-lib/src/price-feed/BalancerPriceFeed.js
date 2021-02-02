const assert = require("assert");
const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BlockHistory, PriceHistory, computeTWAP } = require("./utils");
const { ConvertDecimals } = require("@uma/common");

// Gets balancer spot and historical prices. This price feed assumes that it is returning
// prices as 18 decimals of precision, so it will scale up the pool's price as reported by Balancer contracts
// if the user specifies that the Balancer contract is returning non-18 decimal precision prices.
class BalancerPriceFeed extends PriceFeedInterface {
  constructor(
    logger,
    web3,
    getTime,
    abi,
    address,
    tokenIn,
    tokenOut,
    lookback,
    twapLength,
    poolDecimals = 18,
    priceFeedDecimals = 18
  ) {
    assert(tokenIn, "BalancerPriceFeed requires tokenIn");
    assert(tokenOut, "BalancerPriceFeed requires tokenOut");
    assert(lookback >= 0, "BalancerPriceFeed requires lookback >= 0");
    assert(twapLength >= 0, "BalancerPriceFeed requires lookback >= 0");
    super();
    this.logger = logger;
    this.web3 = web3;
    this.toBN = web3.utils.toBN;
    this.getTime = getTime;

    this.contract = new web3.eth.Contract(abi, address);
    this.uuid = `Balancer-${address}`;
    this.currentPrice = null;
    this.lastUpdateTime = null;
    this.tokenIn = tokenIn;
    this.tokenOut = tokenOut;
    this.lookback = lookback;
    this.twapLength = twapLength;
    this.getLatestBlock = number => web3.eth.getBlock(number >= 0 ? number : "latest");
    // Provide a getblock function which returns the latest value if no number provided.
    this.blockHistory = BlockHistory(this.getLatestBlock);

    // Add a callback to get price, error can be thrown from web3 disconection or maybe something else
    // which affects the update call.
    this.priceHistory = PriceHistory(async number => {
      try {
        let bPoolPrice = this.toBN(
          await this.contract.methods.getSpotPriceSansFee(this.tokenIn, this.tokenOut).call(number)
        );
        // Like the Uniswap price feed, if pool price is 0, then return null
        if (!bPoolPrice.isZero()) {
          return bPoolPrice;
        } else {
          return null;
        }
      } catch (err) {
        // Like the UniswapPriceFeed, when the price is unavailable then return null instead of throwing.
        return null;
      }
    });

    // poolDecimals represents the # of decimals that Balancer pool prices are returned in.
    // TODO: Should/Can we read in `poolDecimals` from this.contract?
    this.poolDecimals = poolDecimals;
    this.priceFeedDecimals = priceFeedDecimals;

    // Convert _bn precision from poolDecimals to desired decimals by scaling up or down based
    // on the relationship between pool precision and the desired decimals.
    this.convertPoolDecimalsToPriceFeedDecimals = ConvertDecimals(this.poolDecimals, this.priceFeedDecimals, this.web3);
  }

  async getHistoricalPrice(time) {
    if (time < this.lastUpdateTime - this.lookback) {
      // Requesting an historical TWAP earlier than the lookback.
      throw new Error(`${this.uuid} time ${time} is earlier than TWAP window`);
    }

    let historicalPrice;
    if (this.twapLength === 0) {
      historicalPrice = this.getSpotPrice(time);
    } else {
      historicalPrice = this._computeTwap(time - this.twapLength, time);
    }

    if (historicalPrice) {
      return this.convertPoolDecimalsToPriceFeedDecimals(historicalPrice);
    } else {
      throw new Error(`${this.uuid} missing historical price @ time ${time}`);
    }
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  getLookback() {
    return this.lookback;
  }

  getCurrentPrice() {
    let currentPrice;
    // If twap window is 0, then return last price
    if (this.twapLength === 0) {
      currentPrice = this.getSpotPrice();
    } else {
      currentPrice = this._computeTwap(this.lastUpdateTime - this.twapLength, this.lastUpdateTime);
    }
    return currentPrice && this.convertPoolDecimalsToPriceFeedDecimals(currentPrice);
  }
  // Not part of the price feed interface. Can be used to pull the balancer price at the most recent block.
  // If `time` is undefined, return latest block price.
  getSpotPrice(time) {
    if (!time) {
      return (
        this.priceHistory.currentPrice() &&
        this.convertPoolDecimalsToPriceFeedDecimals(this.priceHistory.currentPrice())
      );
    } else {
      // We want the block and price equal to or before this time
      const block = this.blockHistory.getClosestBefore(time);
      if (block == null) return null;
      if (!this.priceHistory.has(block.timestamp)) {
        return null;
      }
      return (
        this.priceHistory.get(block.timestamp) &&
        this.convertPoolDecimalsToPriceFeedDecimals(this.priceHistory.get(block.timestamp))
      );
    }
  }

  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }

  async update() {
    const currentTime = await this.getTime();
    this.logger.debug({
      at: "BalancerPriceFeed",
      message: "Updating BalancerPriceFeed",
      lastUpdateTimestamp: currentTime
    });
    let blocks = [];
    // disabled lookback by setting it to 0
    if (this.lookback === 0) {
      // handle no lookback, we just want to insert the latest block into the blockHistory.
      const block = await this.getLatestBlock();
      this.blockHistory.insert(block);
      blocks = this.blockHistory.listBlocks();
    } else {
      // handle historical lookback. Have to be careful your lookback time gives a big enough
      // window to find a single block, otherwise you will have errors. This essentially maps
      // blockHistory.insert() over all blocks in the lookback window.
      blocks = await this.blockHistory.update(this.lookback + this.twapLength, currentTime);
    }
    // The priceHistory.update() method should strip out any blocks where the price is null
    await Promise.all(blocks.map(this.priceHistory.update));

    this.lastUpdateTime = currentTime;
  }
  // If priceHistory only encompasses 1 block, which happens if the `lookback` window is 0,
  // then this should return the last and only price.
  _computeTwap(startTime, endTime) {
    const events = this.priceHistory.list().slice();
    return computeTWAP(events, startTime, endTime, this.toBN("0"));
  }
}

module.exports = {
  BalancerPriceFeed
};
