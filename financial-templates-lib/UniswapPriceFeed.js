const { delay } = require("./delay");
const { Logger } = require("./logger/Logger");
const { LiquidationStatesEnum } = require("../common/Enums");
const { MAX_SAFE_JS_INT } = require("../common/Constants");

// A client for getting price information from a uniswap market.
class UniswapPriceFeed {
  constructor(abi, web3, uniswapAddress, twapLength, getTime) {
    this.web3 = web3;
    this.uniswap = new web3.eth.Contract(abi, uniswapAddress);
    this.twapLength = twapLength;
    this.getTime = getTime;
  }

  getCurrentPrice = () => this.currentPrice;
  getCurrentTwap = () => this.currentTwap;

  _update = async () => {
    // TODO: optimize this call. This may be very slow or break if there are many transactions.
    const events = await this.uniswap.getPastEvents("Sync", { fromBlock: 0 });

    // If there are no prices, return null to allow the user to handle the absense of data.
    if (events.length === 0) {
      this.currentPrice = null;
      this.currentTwap = null;
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
    let i = events.length;
    while (i !== 0) {
      const event = events[--i];
      event.timestamp = (await web3.eth.getBlock(event.blockNumber)).timestamp;
      event.price = this._getPriceFromSyncEvent(event);
      if (event.timestamp <= currentTime - this.twapLength) {
        break;
      }
    }

    // Cut off all the events that were before the time we care about.
    this.events = events.slice(i);

    // Current price
    this.currentPrice = this.events[this.events.length - 1].price;

    // Compute TWAP up to the current time.
    this.currentTwap = this._computeTwap(this.events, currentTime - this.twapLength, currentTime);
  };

  _getPriceFromSyncEvent(event) {
    const { toWei, toBN } = this.web3.utils;
    const fixedPointAdjustment = toBN(toWei("1"));

    // Currently assumes that token0 is the price denominator and token1 is the numerator.
    // TODO: allow the constructor to select the denominator currency.
    const reserve0 = toBN(event.returnValues.reserve0);
    const reserve1 = toBN(event.returnValues.reserve1);

    return reserve1.mul(fixedPointAdjustment).div(reserve0);
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
