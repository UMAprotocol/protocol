// This script gets the current recommended `fast` gas price from ethGasStation
// to inform the Liquidator and dispute bot of a reasonable gas price to use.

const fetch = require("node-fetch");
const url = "https://ethgasstation.info/json/ethgasAPI.json";

class GasEstimator {
  /**
   * @notice Constructs new GasEstimator.
   * @param {Object} logger Winston module used to send logs.
   * @param {Integer} updateThreshold How long, in seconds, the estimator should wait between updates.
   * @param {Integer} defaultFastPriceGwei Default gas price used if the GasEstimator returns an error.
   * @return None or throws an Error.
   */
  constructor(logger, updateThreshold = 60, defaultFastPriceGwei = 40) {
    this.logger = logger;
    this.updateThreshold = updateThreshold;
    this.lastUpdateTimestamp;
    this.lastFastPriceGwei;

    // If the script fails or the API response fails default to this value.
    this.defaultFastPriceGwei = defaultFastPriceGwei;
    this.lastFastPriceGwei = this.defaultFastPriceGwei;
  }

  // Calls update unless it was recently called, as determined by this.updateThreshold.
  update = async () => {
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
  };

  // Returns the current fast gas price in Wei, converted from the stored Gwei value.
  getCurrentFastPrice = () => {
    return this.lastFastPriceGwei * 1e9;
  };

  _update = async () => {
    this.lastFastPriceGwei = await this._getPrice(url);
  };

  _getPrice = async url => {
    try {
      const response = await fetch(url);
      const json = await response.json();
      // The number returned by EthGasStation is a Gwei amount, scaled by 10.
      if (json.fast) {
        let price = json.fast / 10;
        return price;
      } else {
        throw "bad json response";
      }
    } catch (error) {
      this.logger.error({
        at: "GasEstimator",
        message: "client polling error🚨",
        error: new Error(error)
      });

      // In the failure mode return the fast default price.
      return this.defaultFastPriceGwei;
    }
  };
}

module.exports = {
  GasEstimator
};
