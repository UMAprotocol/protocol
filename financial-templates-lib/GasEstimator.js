const fetch = require("node-fetch");
const url = "https://ethgasstation.info/json/ethgasAPI.json";

class GasEstimator {
  constructor(updateThreshold = 60) {
    this.updateThreshold = updateThreshold;
    this.lastUpdateTimestamp;
    this.lastFastPrice;
  }

  _update = async () => {
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime > this.lastUpdateTimestamp + this.updateThreshold) {
      return;
    } else {
      let response = await this.getData(url);
      this.lastFastPrice = response.fast;
    }
  };

  getCurrentFastPrice = () => {
    return this.lastFastPrice;
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
