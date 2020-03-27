const { delay } = require("./delay");
const { Logger } = require("./logger/Logger");
const { LiquidationStatesEnum } = require("../common/Enums");

// A client for getting price information from a uniswap market.
class UniswapPriceFeed {
  constructor(abi, web3, uniswapAddress) {
    this.web3 = web3;
    this.uniswap = new web3.eth.Contract(abi, uniswapAddress);
  }

  getCurrentPrice = () => this.currentPrice;

  _update = async () => {
    // TODO: optimize this call. This may be very slow or break if there are many transactions.
    const events = await this.uniswap.getPastEvents("Sync", { fromBlock: 0 });

    // If there are no prices, return null and allow
    if (events.length === 0) {
      this.currentPrice = null;
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

    // Current price
    this.currentPrice = this._getPriceFromSyncEvent(events[events.length - 1]);
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
}

module.exports = {
  UniswapPriceFeed
};
