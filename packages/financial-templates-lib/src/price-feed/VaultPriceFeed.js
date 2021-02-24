const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BlockFinder } = require("./utils");
const { ConvertDecimals } = require("@uma/common");
class VaultPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new price feed object that tracks the share price of a yearn-style vault.
   * @dev Note: this only supports badger Setts and Yearn v1 right now.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} vaultAbi Yearn Vault abi object to create a contract instance.
   * @param {Object} erc20Abi ERC20 abi object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} vaultAddress Ethereum address of the yearn-style vault to monitor.
   * @param {Function} getTime Returns the current time.
   * @param {Function} [blockFinder] Optionally pass in a shared blockFinder instance (to share the cache).
   * @param {Integer} [minTimeBetweenUpdates] Minimum amount of time that must pass before update will actually run
   *                                        again.
   * @param {Integer} [priceFeedDecimals] Precision that the caller wants precision to be reported in.
   * @return None or throws an Error.
   */
  constructor({
    logger,
    vaultAbi,
    erc20Abi,
    web3,
    vaultAddress,
    getTime,
    blockFinder,
    minTimeBetweenUpdates = 60,
    priceFeedDecimals = 18
  }) {
    super();

    // Assert required inputs.
    assert(logger, "logger required");
    assert(vaultAbi, "vaultAbi required");
    assert(erc20Abi, "erc20Abi required");
    assert(web3, "web3 required");
    assert(vaultAddress, "vaultAddress required");
    assert(getTime, "getTime required");

    this.logger = logger;
    this.web3 = web3;

    this.vault = new web3.eth.Contract(vaultAbi, vaultAddress);
    this.erc20Abi = erc20Abi;
    this.uuid = `Vault-${vaultAddress}`;
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

  async _getPrice(blockNumber = "latest") {
    const rawPrice = await this.vault.methods.getPricePerFullShare().call(undefined, blockNumber);
    return await this._convertDecimals(rawPrice);
  }

  async _convertDecimals(value) {
    if (!this.cachedConvertDecimalsFn) {
      const underlyingTokenAddress = await this.vault.methods.token().call();
      const underlyingToken = new web3.eth.Contract(this.erc20Abi, underlyingTokenAddress);

      let underlyingTokenDecimals;
      try {
        underlyingTokenDecimals = await underlyingToken.methods.decimals().call();
      } catch (err) {
        underlyingTokenDecimals = 18;
      }

      this.cachedConvertDecimalsFn = ConvertDecimals(
        parseInt(underlyingTokenDecimals),
        this.priceFeedDecimals,
        this.web3
      );
    }
    return this.cachedConvertDecimalsFn(value);
  }
}

module.exports = {
  VaultPriceFeed
};
