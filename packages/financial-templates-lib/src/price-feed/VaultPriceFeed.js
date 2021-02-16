const { PriceFeedInterface } = require("./PriceFeedInterface");
const { BlockFinder } = require("./utils");
const { ConvertDecimals } = require("@uma/common");
class VaultPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new price feed object that tracks the share price of a yearn-style vault.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} vaultAbi Yearn Vault abi object to create a contract instance.
   * @param {Object} erc20Abi ERC20 abi object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} vaultAddress Ethereum address of the yearn-style vault to monitor.
   * @param {Function} getTime Returns the current time.
   * @param {Integer} minTimeBetweenUpdates Minimum amount of time that must pass before update will actually run
   *                                        again.
   * @param {Integer} priceFeedDecimals Precision that the caller wants precision to be reported in.
   * @return None or throws an Error.
   */
  constructor(logger, vaultAbi, erc20Abi, web3, vaultAddress, getTime, minTimeBetweenUpdates, priceFeedDecimals = 18) {
    super();
    this.logger = logger;
    this.web3 = web3;

    this.vault = new web3.eth.Contract(vaultAbi, vaultAddress);
    this.erc20Abi = erc20Abi;
    this.uuid = `Vault-${vaultAddress}`;
    this.getTime = getTime;
    this.priceFeedDecimals = priceFeedDecimals;
    this.minTimeBetweenUpdates = minTimeBetweenUpdates;
    this.blockFinder = BlockFinder(web3.eth.getBlock);

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;

    // Convert _bn precision from poolDecimals to desired decimals by scaling up or down based
    // on the relationship between pool precision and the desired decimals.
    this.convertPoolDecimalsToPriceFeedDecimals = ConvertDecimals(this.poolDecimals, this.priceFeedDecimals, this.web3);
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
    if (this.lastUpdateTime === undefined || currentTime > this.lastUpdateTime + this.minTimeBetweenUpdates) {
      this.price = this._getPrice();
      this.lastUpdateTime = currentTime;
    }
  }

  async _getPrice(blockNumber) {
    const rawPrice = await this.vault.methods.getPricePerFullShare().call(undefined, blockNumber);
    this.price = this._convertDecimals(rawPrice);
  }

  async _convertDecimals(value) {
    if (!this.cachedConvertDecimalsFn) {
      const underlyingTokenAddress = await this.vault.methods.token().call();
      const underlyingToken = new web3.eth.Contract(this.erc20Abi, underlyingTokenAddress);

      let underlyingTokenDecimals;
      try {
        underlyingTokenDecimals = (await underlyingToken.methods.decimals().call()).toNumber();
      } catch (err) {
        underlyingTokenDecimals = 18;
      }

      this.cachedConvertDecimalsFn = ConvertDecimals(underlyingTokenDecimals, this.priceFeedDecimals, this.web3);
    }
    return this.cachedConvertDecimalsFn(value);
  }
}

module.exports = {
  VaultPriceFeed
};
