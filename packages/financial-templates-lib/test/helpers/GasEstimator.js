const winston = require("winston");
// Helper
const { delay } = require("../../src/helpers/delay");

// Script to test
const { GasEstimator } = require("../../src/helpers/GasEstimator");

contract("GasEstimator.js", function() {
  let gasEstimator;

  describe("Construction with default config", () => {
    beforeEach(() => {
      const dummyLogger = winston.createLogger({
        level: "info",
        transports: [new winston.transports.Console()]
      });
      gasEstimator = new GasEstimator(dummyLogger);
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
      await delay(1);
      await gasEstimator.update();
      assert.equal(lastUpdateTimestamp, gasEstimator.lastUpdateTimestamp);
    });
  });

  describe("Construction with custom config", () => {
    beforeEach(() => {
      const dummyLogger = winston.createLogger({
        level: "info",
        transports: [new winston.transports.Console()]
      });
      gasEstimator = new GasEstimator(dummyLogger, (updateThreshold = 2), (defaultFastPriceGwei = 10));
    });

    it("Default parameters are set correctly", () => {
      assert.equal(gasEstimator.updateThreshold, 2);
      assert.equal(gasEstimator.defaultFastPriceGwei, 10);
    });
    it("Updates if called after update threshold", async () => {
      await gasEstimator.update();
      const lastUpdateTimestamp = gasEstimator.lastUpdateTimestamp;
      await delay(3);
      await gasEstimator.update();
      assert(lastUpdateTimestamp < gasEstimator.lastUpdateTimestamp);
    });
  });
});
