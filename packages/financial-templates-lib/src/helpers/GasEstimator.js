// This script gets the current recommended `fast` gas price from etherchain
// to inform the Liquidator and dispute bot of a reasonable gas price to use.

const fetch = require("node-fetch");

const GAS_ESTIMATOR_MAPPING_BY_NETWORK = {
  // Expected shape:
  // <netId>: {
  //     url: <primary-gas-station-url>,
  //     backupUrl: <optional-backup-gas-station-url>,
  //     defaultFastPricesGwei: <default-gas-price-for-network>
  // }
  1: {
    url: "https://www.etherchain.org/api/gasPriceOracle",
    backupUrl: "https://api.etherscan.io/api?module=gastracker&action=gasoracle",
    defaultFastPriceGwei: 50,
  },
  137: { url: "https://gasstation-mainnet.matic.network", defaultFastPriceGwei: 10 },
  80001: { url: "https://gasstation-mumbai.matic.today", defaultFastPriceGwei: 20 },
};

const DEFAULT_NETWORK_ID = 1; // Ethereum Mainnet.
class GasEstimator {
  /**
   * @notice Constructs new GasEstimator.
   * @param {Object} logger Winston module used to send logs.
   * @param {Integer} updateThreshold How long, in seconds, the estimator should wait between updates.
   * @param {Integer} networkId Network ID to lookup gas for. Default value is 1 corresponding to Ethereum.
   * @return None or throws an Error.
   */
  constructor(logger, updateThreshold = 60, networkId = DEFAULT_NETWORK_ID) {
    this.logger = logger;
    this.updateThreshold = updateThreshold;
    this.lastUpdateTimestamp;
    this.lastFastPriceGwei;

    // If networkId is not found in GAS_ESTIMATOR_MAPPING_BY_NETWORK, then default to 1.
    if (!Object.keys(GAS_ESTIMATOR_MAPPING_BY_NETWORK).includes(networkId.toString()))
      this.networkId = DEFAULT_NETWORK_ID;
    else this.networkId = networkId;

    // If the script fails or the API response fails default to this value.
    this.defaultFastPriceGwei = GAS_ESTIMATOR_MAPPING_BY_NETWORK[this.networkId].defaultFastPriceGwei;
    this.lastFastPriceGwei = this.defaultFastPriceGwei;
  }

  // Calls update unless it was recently called, as determined by this.updateThreshold.
  async update() {
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime < this.lastUpdateTimestamp + this.updateThreshold) {
      this.logger.debug({
        at: "GasEstimator",
        message: "Gas estimator update skipped",
        networkId: this.networkId,
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTimestamp,
        currentFastPriceGwei: this.lastFastPriceGwei,
        timeRemainingUntilUpdate: this.lastUpdateTimestamp + this.updateThreshold - currentTime,
      });
      return;
    } else {
      await this._update();
      this.lastUpdateTimestamp = currentTime;
      this.logger.debug({
        at: "GasEstimator",
        message: "Gas estimator updated",
        networkId: this.networkId,
        lastUpdateTimestamp: this.lastUpdateTimestamp,
        currentFastPriceGwei: this.lastFastPriceGwei,
      });
    }
  }

  // Returns the current fast gas price in Wei, converted from the stored Gwei value.
  getCurrentFastPrice() {
    // Sometimes the multiplication by 1e9 introduces some error into the resulting number,
    // so we'll conservatively ceil the result before returning. This output is usually passed into
    // a web3 contract call so it MUST be an integer.
    return Math.ceil(this.lastFastPriceGwei * 1e9);
  }

  async _update() {
    this.lastFastPriceGwei = await this._getPrice(this.networkId);
  }

  async _getPrice(_networkId) {
    const url = GAS_ESTIMATOR_MAPPING_BY_NETWORK[_networkId].url;
    const backupUrl = GAS_ESTIMATOR_MAPPING_BY_NETWORK[_networkId].backupUrl;

    if (!url) throw new Error(`Missing URL for network ID ${_networkId}`);

    try {
      const response = await fetch(url);
      const json = await response.json();
      // Primary URL expected response structure:
      // {
      //   "safeLow": "25.0",
      //   "standard": "30.0",
      //   "fast": "35.0",
      //   "fastest": "39.6"
      // }
      if (json.fastest) {
        let price = json.fastest;
        return price;
      } else {
        throw new Error(`Main gas station API @ ${url}: bad json response`);
      }
    } catch (error) {
      this.logger.debug({
        at: "GasEstimator",
        message: "client polling error, trying backup API🚨",
        error: typeof error === "string" ? new Error(error) : error,
      });

      // Try backup API.
      if (backupUrl) {
        try {
          const responseBackup = await fetch(backupUrl);
          const jsonBackup = await responseBackup.json();
          // Etherscan API limits 1 request every 3 seconds without passing in an API key. Expected response structure:
          // {
          //   "status": "1",
          //   "message": "OK-Missing/Invalid API Key, rate limit of 1/3sec applied",
          //   "result": {
          //       "LastBlock": "10330323",
          //       "SafeGasPrice": "30",
          //       "ProposeGasPrice": "41"
          //   }
          // }
          if (jsonBackup.result && jsonBackup.result.ProposeGasPrice) {
            return jsonBackup.result.ProposeGasPrice;
          } else {
            throw new Error(`Backup gas station API @ ${backupUrl}: bad json response`);
          }
        } catch (errorBackup) {
          this.logger.debug({
            at: "GasEstimator",
            message: "backup API failed, falling back to default fast gas price🚨",
            defaultFastPriceGwei: this.defaultFastPriceGwei,
            error: typeof errorBackup === "string" ? new Error(errorBackup) : errorBackup,
          });
        }
      }

      // In the failure mode return the fast default price.
      return this.defaultFastPriceGwei;
    }
  }
}

module.exports = { GasEstimator, GAS_ESTIMATOR_MAPPING_BY_NETWORK };
