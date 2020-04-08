// This script gets the current recommended `fast` gas price from ethGasStation
// to inform the Liquidator and dispute bot of a reasonable gas price to use.

const fetch = require("node-fetch");
const url = "https://ethgasstation.info/json/ethgasAPI.json";
const { Logger } = require("./logger/Logger");

// If no updateThreshold is specified then default to updating every 60 seconds.
class GasEstimator {
  constructor(updateThreshold = 60, defaultFastPriceGwei = 40) {
    this.updateThreshold = updateThreshold;
    this.lastUpdateTimestamp;
    this.lastFastPriceGwei;

    // If the script fails or the API response fails default to this value
    this.defaultFastPriceGwei = defaultFastPriceGwei;
    this.lastFastPriceGwei = this.defaultFastPriceGwei;
  }

  // Calls _update unless it was recently called, as determined by this.updateThreshold.
  update = async () => {
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime < this.lastUpdateTimestamp + this.updateThreshold) {
      Logger.debug({
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
      Logger.debug({
        at: "GasEstimator",
        message: "Gas estimator updated",
        lastUpdateTimestamp: this.lastUpdateTimestamp,
        currentFastPriceGwei: this.lastFastPriceGwei
      });
    }
  };

  _update = async () => {
    let returnedPrice = await this.getPrice(url);
    this.lastFastPriceGwei = returnedPrice;
  };

  // Returns the current fast gas price in Wei, converted from the stored Gwei value.
  getCurrentFastPrice = () => {
    return this.lastFastPriceGwei * 1e9;
  };

  getPrice = async url => {
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
      Logger.error({
        at: "GasEstimator",
        message: "client polling error",
        error: error
      });

      // In the failure mode return the fast default price.
      return this.defaultFastPriceGwei;
    }
  };
}

module.exports = {
  GasEstimator
};
