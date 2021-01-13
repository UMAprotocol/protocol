// An implementation of PriceFeedInterface that uses a Uniswap v2 TWAP as the price feed source.

const { PriceFeedInterface } = require("./PriceFeedInterface");
const { computeTWAP } = require("./utils");
const { ConvertDecimals, averageBlockTimeSeconds } = require("@uma/common");
class UniswapPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new uniswap TWAP price feed object.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} uniswapAbi Uniswap Market Truffle ABI object to create a contract instance to query prices.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} uniswapAddress Ethereum address of the Uniswap market the price feed is monitoring.
   * @param {Integer} twapLength Duration of the time weighted average computation used by the price feed.
   * @param {Integer} historicalLookback How far in the past historical prices will be available using getHistoricalPrice.
   * @param {Function} getTime Returns the current time.
   * @param {Bool} invertPrice Indicates if the Uniswap pair is computed as reserve0/reserve1 (true) or
   * @param {Integer} poolDecimals Precision that prices are reported in on-chain
   * @param {Integer} priceFeedDecimals Precision that the caller wants precision to be reported in
   * @return None or throws an Error.
   */
  constructor(
    logger,
    uniswapAbi,
    web3,
    uniswapAddress,
    twapLength,
    historicalLookback,
    getTime,
    invertPrice,
    poolDecimals = 18,
    priceFeedDecimals = 18
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;

    this.uniswap = new web3.eth.Contract(uniswapAbi, uniswapAddress);
    this.twapLength = twapLength;
    this.getTime = getTime;
    this.historicalLookback = historicalLookback;
    this.invertPrice = invertPrice;
    // The % of the lookback window (historicalLookback + twapLength) that we want to query for Uniswap
    // Sync events. For example, 1.1 = 110% meaning that we'll look back 110% * (historicalLookback + twapLength)
    // seconds, in blocks, for Sync events.
    this.bufferBlockPercent = 1.1;

    // TODO: Should/Can we read in `poolDecimals` from the this.uniswap?
    this.poolPrecision = poolDecimals;
    this.decimals = priceFeedDecimals;

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;

    // Convert _bn precision from poolDecimals to desired decimals by scaling up or down based
    // on the relationship between poolPrecision and the desired decimals.
    this.convertPoolDecimalsToPriceFeedDecimals = ConvertDecimals(this.poolPrecision, this.decimals, this.web3);
  }

  getCurrentPrice() {
    return this.currentTwap && this.convertPoolDecimalsToPriceFeedDecimals(this.currentTwap);
  }

  getHistoricalPrice(time) {
    if (time < this.lastUpdateTime - this.historicalLookback) {
      // Requesting an historical TWAP earlier than the lookback.
      return null;
    }

    const historicalPrice = this._computeTwap(this.events, time - this.twapLength, time);
    return historicalPrice && this.convertPoolDecimalsToPriceFeedDecimals(historicalPrice);
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  getLookback() {
    return this.historicalLookback;
  }

  // Not part of the price feed interface. Can be used to pull the uniswap price at the most recent block.
  getLastBlockPrice() {
    return this.lastBlockPrice && this.convertPoolDecimalsToPriceFeedDecimals(this.lastBlockPrice);
  }

  getPriceFeedDecimals() {
    return this.decimals;
  }

  async update() {
    // Approximate the first block from which we'll need price data from based on the
    // lookback and twap length:
    const lookbackWindow = this.twapLength + this.historicalLookback;
    const latestBlockNumber = (await this.web3.eth.getBlock("latest")).number;
    // Add cushion in case `averageBlockTimeSeconds` overestimates the seconds per block:
    const lookbackBlocks = Math.ceil((this.bufferBlockPercent * lookbackWindow) / (await averageBlockTimeSeconds()));
    const earliestBlockNumber = latestBlockNumber - lookbackBlocks;
    let fromBlock = earliestBlockNumber;
    let events = await this.uniswap.getPastEvents("Sync", { fromBlock: Math.max(fromBlock, 0) });

    // For low-volume pools, it is possible that there are no Sync events within the lookback window.
    // To cover these cases, we'll keep looking back until we find a window with a sync event.
    while (fromBlock >= 0 && events.length === 0) {
      fromBlock -= lookbackBlocks;
      events = await this.uniswap.getPastEvents("Sync", { fromBlock: Math.max(fromBlock, 0) });
    }

    // If there are still no prices, return null to allow the user to handle the absence of data.
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
    // Get Time can either be a synchronous OR asynchronous function depending on how the UniswapPriceFeed is setup.
    // Specifically, when tests are run using hardhat, we use the current block number as the getTimeFunction. This
    // check enables us to support both types of getTime functions.
    const currentTime = this.getTime.constructor.name === "AsyncFunction" ? await this.getTime() : this.getTime();

    const lookbackWindowStart = currentTime - lookbackWindow;
    let i = events.length;
    while (i !== 0) {
      const event = events[--i];
      event.timestamp = (await this.web3.eth.getBlock(event.blockNumber)).timestamp;

      // @dev: _getPriceFromSyncEvent() will return null if the price cannot be calculated, which is possible
      // if one of the reserve amounts is 0 for example.
      event.price = this._getPriceFromSyncEvent(event);

      if (event.timestamp <= lookbackWindowStart) {
        break;
      }
    }

    // Cut off all the events that were before the time we care about.
    this.events = events.slice(i);

    // Filter out events where price is null.
    this.events = events.filter(e => e.price !== null);

    // Price at the end of the most recent block.
    this.lastBlockPrice = this.events[this.events.length - 1].price;

    // Compute TWAP up to the current time.
    this.currentTwap = this._computeTwap(this.events, currentTime - this.twapLength, currentTime);

    this.lastUpdateTime = currentTime;
  }

  _getPriceFromSyncEvent(event) {
    const fixedPointAdjustment = this.toBN(this.toWei("1"));

    // Currently assumes that token0 is the price denominator and token1 is the numerator.
    // TODO: allow the constructor to select the denominator currency.
    const reserve0 = this.toBN(event.returnValues.reserve0);
    const reserve1 = this.toBN(event.returnValues.reserve1);

    if (reserve1.isZero() || reserve0.isZero()) return null;

    if (this.invertPrice) {
      return reserve0.mul(fixedPointAdjustment).div(reserve1);
    } else {
      return reserve1.mul(fixedPointAdjustment).div(reserve0);
    }
  }

  _computeTwap(eventsIn, startTime, endTime) {
    const events = eventsIn.map(e => {
      return [e.timestamp, e.price];
    });
    return computeTWAP(events, startTime, endTime, this.toBN("0"));
  }
}

module.exports = {
  UniswapPriceFeed
};
