const https = require("https");

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
    }
  };
}
