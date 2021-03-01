// An implementation of PriceFeedInterface that uses a Uniswap v2 TWAP as the price feed source.

const { PriceFeedInterface } = require("./PriceFeedInterface");
const { computeTWAP } = require("./utils");
const { ConvertDecimals, averageBlockTimeSeconds, parseFixed } = require("@uma/common");
class UniswapPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new uniswap TWAP price feed object.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} uniswapAbi Uniswap Market Truffle ABI object to create a contract instance to query prices.
   * @param {Object} erc20Abi ERC20 Token Truffle ABI object to create a contract instance to query decimals.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} uniswapAddress Ethereum address of the Uniswap market the price feed is monitoring.
   * @param {Integer} twapLength Duration of the time weighted average computation used by the price feed.
   * @param {Integer} historicalLookback How far in the past historical prices will be available using getHistoricalPrice.
   * @param {Function} getTime Returns the current time.
   * @param {Bool} invertPrice Indicates if the Uniswap pair is computed as reserve0/reserve1 (true) or
   * @param {Integer} priceFeedDecimals Precision that the caller wants precision to be reported in
   * @return None or throws an Error.
   */
  constructor(
    logger,
    uniswapAbi,
    erc20Abi,
    web3,
    uniswapAddress,
    twapLength,
    historicalLookback,
    getTime,
    invertPrice,
    priceFeedDecimals = 18,
    blocks = {}
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;

    // Create Uniswap contract
    this.uniswap = new web3.eth.Contract(uniswapAbi, uniswapAddress);
    this.erc20Abi = erc20Abi;
    this.priceFeedDecimals = priceFeedDecimals;

    this.uuid = `Uniswap-${uniswapAddress}`;
    this.twapLength = twapLength;
    this.getTime = getTime;
    this.historicalLookback = historicalLookback;
    this.invertPrice = invertPrice;
    // The % of the lookback window (historicalLookback + twapLength) that we want to query for Uniswap
    // Sync events. For example, 1.1 = 110% meaning that we'll look back 110% * (historicalLookback + twapLength)
    // seconds, in blocks, for Sync events.
    this.bufferBlockPercent = 1.1;

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.blocks = blocks;
  }

  getCurrentPrice() {
    return this.currentTwap && this.convertToPriceFeedDecimals(this.currentTwap);
  }

  async getHistoricalPrice(time) {
    if (time < this.lastUpdateTime - this.historicalLookback) {
      // Requesting an historical TWAP earlier than the lookback.
      throw new Error(`${this.uuid} time ${time} is earlier than TWAP window`);
    }

    const historicalPrice = this._computeTwap(this.events, time - this.twapLength, time);
    if (historicalPrice) {
      return this.convertToPriceFeedDecimals(historicalPrice);
    } else {
      throw new Error(`${this.uuid} missing historical price @ time ${time}`);
    }
  }

  // This function does not return the same type of price data as getHistoricalPrice. It returns the raw
  // price history from uniswap without a twap. This is by choice, since a twap calculation across the entire
  // history is 1. complicated and 2. unecessary as this function is only needed for affliate calculations.
  getHistoricalPricePeriods() {
    return this.events.map(event => {
      return [event.timestamp, this.convertToPriceFeedDecimals(event.price)];
    });
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  getLookback() {
    return this.historicalLookback;
  }

  // Not part of the price feed interface. Can be used to pull the uniswap price at the most recent block.
  getLastBlockPrice() {
    return this.lastBlockPrice && this.convertToPriceFeedDecimals(this.lastBlockPrice);
  }

  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }

  async update() {
    // Read token0 and token1 precision from Uniswap contract if not already cached:
    if (!this.token0Precision || !this.token1Precision || !this.convertToPriceFeedDecimals) {
      const [token0Address, token1Address] = await Promise.all([
        this.uniswap.methods.token0().call(),
        this.uniswap.methods.token1().call()
      ]);
      this.token0 = new this.web3.eth.Contract(this.erc20Abi, token0Address);
      this.token1 = new this.web3.eth.Contract(this.erc20Abi, token1Address);
      const [token0Precision, token1Precision] = await Promise.all([
        this.token0.methods.decimals().call(),
        this.token1.methods.decimals().call()
      ]);
      this.token0Precision = token0Precision;
      this.token1Precision = token1Precision;
      // `_getPriceFromSyncEvent()` returns prices in the same precision as `token1` unless price is inverted.
      // Therefore, `convertToPriceFeedDecimals` will convert from `token1Precision`
      // to the user's desired `priceFeedDecimals`, unless inverted then it will convert from
      // `token0Precision` to `priceFeedDecimals`.
      this.convertToPriceFeedDecimals = ConvertDecimals(
        Number(this.invertPrice ? this.token0Precision : this.token1Precision),
        this.priceFeedDecimals,
        this.web3
      );
    }

    // Approximate the first block from which we'll need price data from based on the
    // lookback and twap length:
    const lookbackWindow = this.twapLength + this.historicalLookback;
    const currentTime = await this.getTime();
    const earliestLookbackTime = currentTime - lookbackWindow;
    const latestBlockNumber = (await this.web3.eth.getBlock("latest")).number;
    // Add cushion in case `averageBlockTimeSeconds` underestimates the seconds per block:
    let lookbackBlocks = Math.ceil((this.bufferBlockPercent * lookbackWindow) / (await averageBlockTimeSeconds()));

    let events = []; // Caches sorted events (to keep subsequent event queries as small as possible).
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
            if (!this.blocks[event.blockNumber]) {
              this.blocks[event.blockNumber] = this.web3.eth
                .getBlock(event.blockNumber)
                .then(block => ({ timestamp: block.timestamp, number: block.number }));
            }

            // Add a .then to the promise that sets the timestamp (and price) for this event after the promise resolves.
            return this.blocks[event.blockNumber].then(block => {
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
    // Fixed point adjustment should use same precision as token0, unless price is inverted.
    const fixedPointAdjustment = this.toBN(
      parseFixed("1", this.invertPrice ? this.token1Precision : this.token0Precision).toString()
    );

    const reserve0 = this.toBN(event.returnValues.reserve0);
    const reserve1 = this.toBN(event.returnValues.reserve1);

    if (reserve1.isZero() || reserve0.isZero()) return null;

    // Price is returned using same precision as base currency, which is token1 unless inverted.
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
