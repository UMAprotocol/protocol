// This script gets the current recommended `fast` gas price from ethGasStation
// to inform the Liquidator and dispute bot of a reasonable gas price to use.

const fetch = require("node-fetch");
const url = "https://ethgasstation.info/json/ethgasAPI.json";

// If no updateThreshold is specified then default to updating every 60 seconds.
class GasEstimator {
  constructor(updateThreshold = 60) {
    this.updateThreshold = updateThreshold;
    this.lastUpdateTimestamp;
    this.lastFastPriceGwei = 20; // default until updated by the `_update` function.
  }

  _update = async () => {
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > this.lastUpdateTimestamp + this.updateThreshold) {
      return;
    } else {
      let response = await this.getData(url);
      // The number returned by EthGasStation is a Gwei amount, scaled by 10.
      this.lastFastPriceGwei = response.fast / 10;
    }
  };

  // Returns the current fast gas price in Wei, converted from the stored Gwei value.
  getCurrentFastPrice = () => {
    return this.lastFastPriceGwei * 1e9;
  };

  getData = async url => {
    try {
      const response = await fetch(url);
      const json = await response.json();
      return json;
    } catch (error) {
      console.log(error);
    }
  };
}

module.exports = {
  GasEstimator
};
