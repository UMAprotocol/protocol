const assert = require("assert");
const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BlockHistory, PriceHistory } = require("./utils");
const { parseFixed } = require("@ethersproject/bignumber");
const { MAX_SAFE_JS_INT } = require("@uma/common");

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
    decimals = 18
  ) {
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
    this.twapLength = twapLength;
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
    if (time < this.lastUpdateTime - this.lookback) {
      // Requesting an historical TWAP earlier than the lookback.
      return null;
    }

    if (this.twapLength === 0) {
      const historicalSpotPrice = this.getSpotPrice(time);
      return historicalSpotPrice && this.convertDecimals(historicalSpotPrice);
    } else {
      const historicalTwap = this._computeTwap(time - this.twapLength, time);
      return historicalTwap && this.convertDecimals(historicalTwap);
    }
  }
  getLastUpdateTime() {
    return this.lastUpdateTime;
  }
  getCurrentPrice() {
    if (this.twapLength === 0) {
      const currentSpotPrice = this.getSpotPrice();
      return currentSpotPrice && this.convertDecimals(currentSpotPrice);
    } else {
      return this.currentTwap && this.convertDecimals(this.currentTwap);
    }
  }
  // Not part of the price feed interface. Can be used to pull the balancer price at the most recent block.
  getSpotPrice(time) {
    if (!time) {
      // current price can be undefined, will throw for any other errors
      return this.convertDecimals(this.priceHistory.currentPrice());
    } else {
      // We want the block and price equal to or before this time
      const block = this.blockHistory.getClosestBefore(time);
      if (block == null) return null;
      if (!this.priceHistory.has(block.timestamp)) {
        return null;
      }
      return this.convertDecimals(this.priceHistory.get(block.timestamp));
    }
  }
  async update() {
    const currentTime = await this.getTime();
    this.logger.debug({
      at: "BalancerPriceFeed",
      message: "Updating",
      lastUpdateTimestamp: currentTime
    });
    let blocks = [];
    // disabled lookback by setting it and twapLength to 0
    const lookbackWindow = this.twapLength + this.lookback;
    if (lookbackWindow === 0) {
      // handle no lookback, we just want latest block
      const block = await this.getLatestBlock();
      this.blockHistory.insert(block);
      blocks = this.blockHistory.listBlocks();
    } else {
      // handle historical lookback. Have to be careful your lookback time gives a big enough
      // window to find a single block, otherwise you will have errors.
      blocks = await this.blockHistory.update(lookbackWindow, currentTime);
    }
    await Promise.all(blocks.map(this.priceHistory.update));

    // Compute TWAP up to the current time.
    this.currentTwap = this._computeTwap(currentTime - this.twapLength, currentTime);

    this.lastUpdateTime = currentTime;
  }
  _computeTwap(startTime, endTime) {
    // Add fake element that's far in the future to the end of the array to simplify TWAP calculation.
    const events = this.priceHistory.list().slice();
    events.push([MAX_SAFE_JS_INT, null]);

    let lastPrice = null;
    let lastTime = null;
    let priceSum = this.toBN("0");
    let timeSum = 0;
    for (const event of events) {
      // Because the price window goes up until the next event, computation cannot start until event 2.
      if (lastTime && lastPrice) {
        const startWindow = Math.max(lastTime, startTime);
        const endWindow = Math.min(event[0], endTime);
        const windowLength = Math.max(endWindow - startWindow, 0);
        priceSum = priceSum.add(lastPrice.muln(windowLength));
        timeSum += windowLength;
      }

      if (event[0] > endTime) {
        break;
      }

      lastPrice = event[1];
      lastTime = event[0];
    }

    if (timeSum === 0) {
      return null;
    }

    return priceSum.divn(timeSum);
  }
}

module.exports = {
  BalancerPriceFeed
};
