const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BlockFinder } = require("./utils");
const { ConvertDecimals } = require("@uma/common");
const assert = require("assert");

class FundingRateMultiplierPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new price feed object that tracks the funding rate multiplier in a particular perpetual contract.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} perpetualAbi Perpetual abi object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} perpetualAddress Ethereum address of the perpetual to monitor.
   * @param {Function} getTime Returns the current time.
   * @param {Function} [blockFinder] Optionally pass in a shared blockFinder instance (to share the cache).
   * @param {Integer} [minTimeBetweenUpdates] Minimum time that must pass before update will actually run again.
   * @param {Integer} [priceFeedDecimals] Precision that the caller wants precision to be reported in.
   * @return None or throws an Error.
   */
  constructor({
    logger,
    perpetualAbi,
    web3,
    perpetualAddress,
    getTime,
    blockFinder,
    minTimeBetweenUpdates = 60,
    priceFeedDecimals = 18
  }) {
    super();

    // Assert required inputs.
    assert(logger, "logger required");
    assert(perpetualAbi, "perpetualAbi required");
    assert(web3, "web3 required");
    assert(web3.utils.isAddress(perpetualAddress), "perpetualAddress required");
    assert(getTime, "getTime required");

    this.logger = logger;
    this.web3 = web3;

    this.perpetual = new web3.eth.Contract(perpetualAbi, perpetualAddress);
    this.uuid = `FundingRateMultiplier-${perpetualAddress}`;
    this.getTime = getTime;
    this.priceFeedDecimals = priceFeedDecimals;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.blockFinder = blockFinder || BlockFinder(web3.eth.getBlock);
    this.convertDecimals = ConvertDecimals(18, priceFeedDecimals, web3);
  }

  getCurrentPrice() {
    return this.price;
  }

  async getHistoricalPrice(time) {
    const block = await this.blockFinder.getBlockForTimestamp(time);
    return this._getPrice(block.number);
  }

  getLastUpdateTime() {
    return this.lastUpdateTime;
  }

  getLookback() {
    // Return infinity since this price feed can technically look back as far as needed.
    return Infinity;
  }

  getPriceFeedDecimals() {
    return this.priceFeedDecimals;
  }

  async update() {
    const currentTime = await this.getTime();
    if (this.lastUpdateTime === undefined || currentTime >= this.lastUpdateTime + this.minTimeBetweenUpdates) {
      this.price = await this._getPrice();
      this.lastUpdateTime = currentTime;
    }
  }

  async _getPrice(blockNumber = "latest") {
    const { cumulativeMultiplier } = await this.perpetual.methods.fundingRate().call(undefined, blockNumber);
    return this.convertDecimals(cumulativeMultiplier.rawValue);
  }
}

module.exports = {
  FundingRateMultiplierPriceFeed
};
