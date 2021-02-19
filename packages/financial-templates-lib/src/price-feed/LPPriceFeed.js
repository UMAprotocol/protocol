const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BlockFinder } = require("./utils");
const { ConvertDecimals } = require("@uma/common");
const assert = require("assert");
class LPPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new price feed object that tracks how much of a provided token a single LP share is redeemable
   *         for.
   * @dev Note: this can support most LP shares and may support other types of pool contracts.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {Object} erc20Abi ERC20 abi object to create a contract instance.
   * @param {String} poolAddress Ethereum address of the LP pool to monitor.
   * @param {String} tokenAddress Ethereum address of the per-share token balance we're tracking within the pool.
   * @param {Function} getTime Returns the current time.
   * @param {Function} [blockFinder] Optionally pass in a shared blockFinder instance (to share the cache).
   * @param {Integer} [minTimeBetweenUpdates] Minimum amount of time that must pass before update will actually run
   *                                        again.
   * @param {Integer} [priceFeedDecimals] Precision that the caller wants precision to be reported in.
   * @return None or throws an Error.
   */
  constructor({
    logger,
    web3,
    erc20Abi,
    poolAddress,
    tokenAddress,
    getTime,
    blockFinder,
    minTimeBetweenUpdates = 60,
    priceFeedDecimals = 18
  }) {
    super();

    // Assert required arguments.
    assert(logger, "logger required");
    assert(web3, "web3 required");
    assert(erc20Abi, "erc20Abi required");
    assert(poolAddress, "poolAddress required");
    assert(tokenAddress, "tokenAddress required");
    assert(getTime, "getTime required");

    this.logger = logger;
    this.web3 = web3;
    this.toBN = web3.utils.toBN;

    this.pool = new web3.eth.Contract(erc20Abi, poolAddress);
    this.token = new web3.eth.Contract(erc20Abi, tokenAddress);
    this.uuid = `LP-${poolAddress}-${tokenAddress}`;
    this.getTime = getTime;
    this.priceFeedDecimals = priceFeedDecimals;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.blockFinder = blockFinder || BlockFinder(web3.eth.getBlock);
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

  async _getDecimals() {
    if (this.tokenDecimals === undefined) {
      this.tokenDecimals = parseInt(await this.token.methods.decimals().call());
    }

    if (this.poolDecimals === undefined) {
      this.poolDecimals = parseInt(await this.pool.methods.decimals().call());
    }

    return { poolDecimals: this.poolDecimals, tokenDecimals: this.tokenDecimals };
  }

  async _getPrice(blockNumber = "latest") {
    const lpTotalSupply = this.toBN(await this.pool.methods.totalSupply().call(undefined, blockNumber));
    const tokensInPool = this.toBN(
      await this.token.methods.balanceOf(this.pool.options.address).call(undefined, blockNumber)
    );

    // 10^decimals is the fixed point multiplier for the pool.
    const { poolDecimals } = await this._getDecimals();
    const poolDecimalMultiplier = this.toBN("10").pow(this.toBN(poolDecimals));

    // To get the price, we divide the total tokens in the pool by the number of LP shares.
    // Note: this produces a rawPrice that is in terms of the token's decimals, not the pool's.
    // Note: if the total supply is zero, then we just set the price to 0 since no LP tokens exist.
    const rawPrice = lpTotalSupply.isZero()
      ? web3.utils.toBN("0")
      : tokensInPool.mul(poolDecimalMultiplier).divRound(lpTotalSupply);

    // _convertDecimals takes a price with the token's decimals and returns it in terms of priceFeedDecimals.
    return await this._convertDecimals(rawPrice);
  }

  // Converts decimals from the token decimals to the configured output decimals.
  async _convertDecimals(value) {
    const { tokenDecimals } = await this._getDecimals();
    const convertDecimals = ConvertDecimals(tokenDecimals, this.priceFeedDecimals, this.web3);
    return convertDecimals(value);
  }
}

module.exports = {
  LPPriceFeed
};
