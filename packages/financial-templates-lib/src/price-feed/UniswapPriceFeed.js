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
    this.poolDecimals = poolDecimals;
    this.priceFeedDecimals = priceFeedDecimals;

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;

    // Convert _bn precision from poolDecimals to desired decimals by scaling up or down based
    // on the relationship between pool precision and the desired decimals.
    this.convertPoolDecimalsToPriceFeedDecimals = ConvertDecimals(this.poolDecimals, this.priceFeedDecimals, this.web3);
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
    return this.priceFeedDecimals;
  }

  async update() {
    // Approximate the first block from which we'll need price data from based on the
    // lookback and twap length:
    const lookbackWindow = this.twapLength + this.historicalLookback;
    const currentTime = await this.getTime();
    const earliestLookbackTime = currentTime - lookbackWindow;
    const latestBlockNumber = (await this.web3.eth.getBlock("latest")).number;
    // Add cushion in case `averageBlockTimeSeconds` underestimates the seconds per block:
    let lookbackBlocks = Math.ceil((this.bufferBlockPercent * lookbackWindow) / (await averageBlockTimeSeconds()));

    let events = []; // Caches sorted events (to keep subsequent event queries as small as possible).
    let blocks = {}; // Caches blocks (so we don't have to re-query timestamps).
    let fromBlock = Infinity; // Arbitrary initial value > 0.

    // For loop continues until the start block hits 0 or the first event is before the earlest lookback time.
    for (let i = 0; !(fromBlock === 0 || events[0]?.timestamp <= earliestLookbackTime); i++) {
      // Uses latest unless the events array already has data. If so, it only queries _before_ existing events.
      const toBlock = events[0] ? events[0].blockNumber - 1 : "latest";

      // By taking larger powers of 2, this doubles the lookback each time.
      fromBlock = Math.max(0, latestBlockNumber - lookbackBlocks * 2 ** i);

      const newEvents = await this._getSortedSyncEvents(fromBlock, toBlock).then(newEvents => {
        // Grabs the timestamps for all blocks, but avoids re-querying by .then-ing any cached blocks.
        return Promise.all(
          newEvents.map(event => {
            // If there is nothing in the cache for this block number, add a new promise that will resolve to the block.
            if (!blocks[event.blockNumber]) {
              blocks[event.blockNumber] = this.web3.eth.getBlock(event.blockNumber);
            }

            // Add a .then to the promise that sets the timestamp (and price) for this event after the promise resolves.
            return blocks[event.blockNumber].then(block => {
              event.timestamp = block.timestamp;
              event.price = this._getPriceFromSyncEvent(event);
              return event;
            });
          })
        );
      });

      // Adds newly queried events to the array.
      events = [...newEvents, ...events];
    }

    // If there are still no prices, return null to allow the user to handle the absence of data.
    if (events.length === 0) {
      this.currentTwap = null;
      this.lastBlockPrice = null;
      this.events = [];
      return;
    }

    // Filter out events where price is null.
    this.events = events.filter(e => e.price !== null);

    // Price at the end of the most recent block.
    this.lastBlockPrice = this.events[this.events.length - 1].price;

    // Compute TWAP up to the current time.
    this.currentTwap = this._computeTwap(this.events, currentTime - this.twapLength, currentTime);

    this.lastUpdateTime = currentTime;
  }

  async _getSortedSyncEvents(fromBlock, toBlock) {
    const events = await this.uniswap.getPastEvents("Sync", { fromBlock: fromBlock, toBlock: toBlock });
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

    return events;
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
