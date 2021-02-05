// This script gets the current recommended `fast` gas price from etherchain
// to inform the Liquidator and dispute bot of a reasonable gas price to use.

const fetch = require("node-fetch");
// Etherchain expected response structure:
// {
//   "safeLow": "25.0",
//   "standard": "30.0",
//   "fast": "35.0",
//   "fastest": "39.6"
// }
const url = "https://www.etherchain.org/api/gasPriceOracle";
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
const backupUrl = "https://api.etherscan.io/api?module=gastracker&action=gasoracle";

class GasEstimator {
  /**
   * @notice Constructs new GasEstimator.
   * @param {Object} logger Winston module used to send logs.
   * @param {Integer} updateThreshold How long, in seconds, the estimator should wait between updates.
   * @param {Integer} defaultFastPriceGwei Default gas price used if the GasEstimator returns an error.
   * @return None or throws an Error.
   */
  constructor(logger, updateThreshold = 60, defaultFastPriceGwei = 50) {
    this.logger = logger;
    this.updateThreshold = updateThreshold;
    this.lastUpdateTimestamp;
    this.lastFastPriceGwei;

    // If the script fails or the API response fails default to this value.
    this.defaultFastPriceGwei = defaultFastPriceGwei;
    this.lastFastPriceGwei = this.defaultFastPriceGwei;
  }

  // Calls update unless it was recently called, as determined by this.updateThreshold.
  async update() {
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime < this.lastUpdateTimestamp + this.updateThreshold) {
      this.logger.debug({
        at: "GasEstimator",
        message: "Gas estimator update skipped",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTimestamp,
        currentFastPriceGwei: this.lastFastPriceGwei,
        timeRemainingUntilUpdate: this.lastUpdateTimestamp + this.updateThreshold - currentTime
      });
      return;
    } else {
      await this._update();
      this.lastUpdateTimestamp = currentTime;
      this.logger.debug({
        at: "GasEstimator",
        message: "Gas estimator updated",
        lastUpdateTimestamp: this.lastUpdateTimestamp,
        currentFastPriceGwei: this.lastFastPriceGwei
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
    this.lastFastPriceGwei = await this._getPrice(url);
  }

  async _getPrice(url) {
    try {
      const response = await fetch(url);
      const json = await response.json();
      if (json.fast) {
        let price = json.fast;
        return price;
      } else {
        throw new Error("Etherchain API: bad json response");
      }
    } catch (error) {
      this.logger.debug({
        at: "GasEstimator",
        message: "client polling error, trying backup API🚨",
        error: typeof error === "string" ? new Error(error) : error
      });

      // Try backup API.
      try {
        const responseBackup = await fetch(backupUrl);
        const jsonBackup = await responseBackup.json();
        if (jsonBackup.result && jsonBackup.result.SafeGasPrice) {
          return jsonBackup.result.SafeGasPrice;
        } else {
          throw new Error("Etherscan API: bad json response");
        }
      } catch (errorBackup) {
        this.logger.debug({
          at: "GasEstimator",
          message: "backup API failed, falling back to default fast gas price🚨",
          defaultFastPriceGwei: this.defaultFastPriceGwei,
          error: typeof errorBackup === "string" ? new Error(errorBackup) : errorBackup
        });
      }

      // In the failure mode return the fast default price.
      return this.defaultFastPriceGwei;
    }
  }
}

module.exports = {
  GasEstimator
};
