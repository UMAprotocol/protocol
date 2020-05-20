const { PriceFeedInterface } = require("./PriceFeedInterface");

const { MAX_SAFE_JS_INT } = require("../../common/Constants");

// An implementation of PriceFeedInterface that uses a Uniswap v2 TWAP as the price feed source.
class UniswapPriceFeed extends PriceFeedInterface {
  constructor(logger, abi, web3, uniswapAddress, twapLength, historicalLookback, getTime, invertPrice) {
    super();
    this.logger = logger;
    this.web3 = web3;
    this.uniswap = new web3.eth.Contract(abi, uniswapAddress);
    this.twapLength = twapLength;
    this.getTime = getTime;
    this.historicalLookback = historicalLookback;
    this.invertPrice = invertPrice;
  }

  getCurrentPrice() {
    return this.currentTwap;
  }

  getHistoricalPrice(time) {
    if (time < this.lastUpdateTime - this.historicalLookback) {
      // Requesting an historical TWAP earlier than the lookback.
      return null;
    }

    return this._computeTwap(this.events, time - this.twapLength, time);
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  // Not part of the price feed interface. Can be used to pull the uniswap price at the most recent block.
  getLastBlockPrice() {
    return this.lastBlockPrice;
  }

  async update() {
    // TODO: optimize this call. This may be very slow or break if there are many transactions.
    const events = await this.uniswap.getPastEvents("Sync", { fromBlock: 0 });

    // If there are no prices, return null to allow the user to handle the absense of data.
    if (events.length === 0) {
      this.currentTwap = null;
      this.lastBlockPrice = null;
      this.events = [];
      return;
    }

    // Primary sort on block number. Secondary sort on transactionIndex. Tertiary sort on logIndex.
    events.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }

      if (a.transactionIndex !== b.transactionIndex) {
        return a.transactionIndex - b.transactionIndex;
      }

      return a.logIndex - b.logIndex;
    });

    // Search backwards through the array and grab block timestamps for everything in our lookback window.
    const currentTime = this.getTime();
    const lookbackWindowStart = currentTime - (this.twapLength + this.historicalLookback);
    let i = events.length;
    while (i !== 0) {
      const event = events[--i];
      event.timestamp = (await this.web3.eth.getBlock(event.blockNumber)).timestamp;
      event.price = this._getPriceFromSyncEvent(event);
      if (event.timestamp <= lookbackWindowStart) {
        break;
      }
    }

    // Cut off all the events that were before the time we care about.
    this.events = events.slice(i);

    // Price at the end of the most recent block.
    this.lastBlockPrice = this.events[this.events.length - 1].price;

    // Compute TWAP up to the current time.
    this.currentTwap = this._computeTwap(this.events, currentTime - this.twapLength, currentTime);

    this.lastUpdateTime = currentTime;
  }

  _getPriceFromSyncEvent(event) {
    const { toWei, toBN } = this.web3.utils;
    const fixedPointAdjustment = toBN(toWei("1"));

    // Currently assumes that token0 is the price denominator and token1 is the numerator.
    // TODO: allow the constructor to select the denominator currency.
    const reserve0 = toBN(event.returnValues.reserve0);
    const reserve1 = toBN(event.returnValues.reserve1);

    if (this.invertPrice) {
      return reserve0.mul(fixedPointAdjustment).div(reserve1);
    } else {
      return reserve1.mul(fixedPointAdjustment).div(reserve0);
    }
  }

  _computeTwap(eventsIn, startTime, endTime) {
    const { toBN } = this.web3.utils;

    // Add fake element that's far in the future to the end of the array to simplify TWAP calculation.
    const events = eventsIn.slice();
    events.push({ timestamp: MAX_SAFE_JS_INT });

    let lastPrice = null;
    let lastTime = null;
    let priceSum = toBN("0");
    let timeSum = 0;
    for (const event of events) {
      // Because the price window goes up until the next event, computation cannot start until event 2.
      if (lastTime && lastPrice) {
        const startWindow = Math.max(lastTime, startTime);
        const endWindow = Math.min(event.timestamp, endTime);
        const windowLength = Math.max(endWindow - startWindow, 0);
        priceSum = priceSum.add(lastPrice.muln(windowLength));
        timeSum += windowLength;
      }

      if (event.timestamp > endTime) {
        break;
      }

      lastPrice = event.price;
      lastTime = event.timestamp;
    }

    if (timeSum === 0) {
      return null;
    }

    return priceSum.divn(timeSum);
  }
}

module.exports = {
  UniswapPriceFeed
};
