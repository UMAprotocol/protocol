// An implementation of PriceFeedInterface that calculates the expiry price of the uPUNK index over a given period.

const { PriceFeedInterface } = require("./PriceFeedInterface");
const { averageBlockTimeSeconds } = require("@uma/common");
class UpunkPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new uPUNK expiry price feed object.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} cryptopunkABI CryptoPunk contract Truffle ABI object to create a contract instance to query PunkBought events.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} cryptopunkAddress Ethereum address of the CryptoPunk contract.
   * @param {Integer} historicalLookback How far in the past historical prices will be available using getHistoricalPrice.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} priceFeedDecimals Precision that the caller wants precision to be reported in.
   * @return None or throws an Error.
   */
  constructor(
    logger,
    cryptopunkABI,
    web3,
    cryptopunkAddress,
    historicalLookback,
    getTime,
    priceFeedDecimals = 6,
    blocks = {}
  ) {
    super();
    this.logger = logger;
    this.web3 = web3;

    // Create CryptoPunk contract
    this.cryptopunk = new web3.eth.Contract(cryptopunkABI, cryptopunkAddress);
    this.priceFeedDecimals = priceFeedDecimals;

    this.getTime = getTime;
    this.historicalLookback = historicalLookback;
    // The % of the lookback window (historicalLookback) that we want to query for PunkBought
    // events. For example, 1.1 = 110% meaning that we'll look back 110% * historicalLookback
    // seconds, in blocks, for PunkBought events.
    this.bufferBlockPercent = 1.1;

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.blocks = blocks;
  }

  getCurrentPrice() {
    this.convertToPriceFeedDecimals(this.currentPrice);
  }

  async getHistoricalPrice(time) {
    if (time < this.lastUpdateTime - this.historicalLookback) {
      // Requesting an historical price earlier than the lookback.
      throw new Error(`Time ${time} is earlier than beginning of lookback window`);
    }

    const historicalPrice = this._computePrice(this.events, time - 2592000, time); // 2592000 seconds == 30 days
    if (historicalPrice) {
      return this.convertToPriceFeedDecimals(historicalPrice);
    } else {
      throw new Error(`Contract missing historical price @ time ${time}`);
    }
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  getLookback() {
    return this.historicalLookback;
  }

  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }

  async update() {
    // Approximate the first block from which we'll need price data from based on the
    // lookback:
    const lookbackWindow = this.historicalLookback;
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

      const newEvents = await this._getSortedPunkBoughtEvents(fromBlock, toBlock).then(newEvents => {
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
              event.price = event.returnValues.value;
              event.punkIndex = event.returnValues.punkIndex;
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
      this.events = [];
      return;
    }

    // Filter out events where price is null.
    this.events = events.filter(e => e.price !== null);

    // Compute 30-day median price up to the current time.
    this.currentPrice = this._computePrice(this.events, currentTime - 2592000, currentTime); // 2592000 == 30 days

    this.lastUpdateTime = currentTime;
  }

  async _getSortedPunkBoughtEvents(fromBlock, toBlock) {
    const events = await this.cryptopunk.getPastEvents("PunkBought", { fromBlock: fromBlock, toBlock: toBlock });
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

  _computePrice(/* eventsIn, startTime, endTime */) {
    // const events = eventsIn.map(e => {
    //   return [e.timestamp, e.value, e.punkIndex];
    // });
    // only return most recent price for each cryptopunk
  }
}

module.exports = {
  UpunkPriceFeed
};
