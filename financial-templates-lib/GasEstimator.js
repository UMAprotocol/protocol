// This script gets the current recommended `fast` gas price from ethGasStation
// to inform the Liquidator and dispute bot of a reasonable gas price to use.

const fetch = require("node-fetch");
const url = "https://ethgasstation.info/json/ethgasAPI.json";
const { Logger } = require("./Logger");

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

  _update = async () => {
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime < this.lastUpdateTimestamp + this.updateThreshold) {
      Logger.debug({
        at: "GasEstimator",
        message: "Gas Estimator update skipped due to update threshold",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTimestamp,
        lastFastPriceGwei: this.lastFastPriceGwei,
        timeRemainingUntilUpdate: this.lastUpdateTimestamp + this.updateThreshold - currentTime
      });
      return;
    } else {
      let returnedPrice = await this.getPrice(url);
      this.lastFastPriceGwei = returnedPrice;
      this.lastUpdateTimestamp = currentTime;
      Logger.debug({
        at: "GasEstimator",
        message: "Gas Estimator updated",
        currentFastPrice: returnedPrice,
        lastUpdateTimestamp: this.lastUpdateTimestamp
      });
    }
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
      let price = json.fast / 10;
      return price;
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
