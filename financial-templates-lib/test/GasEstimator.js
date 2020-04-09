const { delay } = require("../delay");

const { GasEstimator } = require("../GasEstimator");

contract("GasEstimator.js", function() {
  let gasEstimator;

  describe("Construction with default config", () => {
    beforeEach(() => {
      gasEstimator = new GasEstimator();
    });

    it("Default parameters are set correctly", () => {
      assert(gasEstimator.updateThreshold > 0);
      assert(gasEstimator.defaultFastPriceGwei > 0);
    });
    it("Returns gas prices in wei before initial update", () => {
      assert.equal(gasEstimator.defaultFastPriceGwei, gasEstimator.getCurrentFastPrice() / 1e9);
    });
    it("Returns gas prices in wei after update", async () => {
      await gasEstimator.update();
      const latestFastGasPrice = gasEstimator.getCurrentFastPrice() / 1e9;
      if (latestFastGasPrice === gasEstimator.defaultFastPriceGwei) {
        console.log(`API Request to ethgasstation.info failed, using default gas price in Gwei: ${latestFastGasPrice}`);
      }
      assert(latestFastGasPrice > 0);
    });
    it("Does not update if called before update threshold", async () => {
      await gasEstimator.update();
      const lastUpdateTimestamp = gasEstimator.lastUpdateTimestamp;
      await delay(Number(1_000));
      await gasEstimator.update();
      assert.equal(lastUpdateTimestamp, gasEstimator.lastUpdateTimestamp);
    });
  });

  describe("Construction with custom config", () => {
    beforeEach(() => {
      gasEstimator = new GasEstimator((updateThreshold = 1.5), (defaultFastPriceGwei = 10));
    });

    it("Default parameters are set correctly", () => {
      assert.equal(gasEstimator.updateThreshold, 1.5);
      assert.equal(gasEstimator.defaultFastPriceGwei, 10);
    });
    it("Updates if called after update threshold", async () => {
      await gasEstimator.update();
      const lastUpdateTimestamp = gasEstimator.lastUpdateTimestamp;
      await delay(Number(1_500));
      await gasEstimator.update();
      assert(lastUpdateTimestamp < gasEstimator.lastUpdateTimestamp);
    });
  });
});
