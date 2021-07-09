const winston = require("winston");
// Helper
const { delay } = require("../../src/helpers/delay");

// Script to test
const { GasEstimator, GAS_ESTIMATOR_MAPPING_BY_NETWORK } = require("../../src/helpers/GasEstimator");

contract("GasEstimator.js", function () {
  let gasEstimator;

  describe("Construction with default config", () => {
    beforeEach(() => {
      const dummyLogger = winston.createLogger({
        level: "info",
        transports: [new winston.transports.Console()],
      });
      gasEstimator = new GasEstimator(dummyLogger);
    });

    it("Default parameters are set correctly", () => {
      assert(gasEstimator.updateThreshold > 0);
      assert.equal(
        gasEstimator.defaultFastPriceGwei,
        GAS_ESTIMATOR_MAPPING_BY_NETWORK[1].defaultFastPriceGwei,
        "defaultFastPriceGwei for networkId 1 incorrect"
      );
      assert.equal(gasEstimator.networkId, 1, "default networkId should be 1");
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
    // Choose a network ID specified in GAS_ESTIMATOR_MAPPING_BY_NETWORK.
    const customNetworkId = 137;

    beforeEach(() => {
      const dummyLogger = winston.createLogger({
        level: "info",
        transports: [new winston.transports.Console()],
      });
      gasEstimator = new GasEstimator(dummyLogger, /* updateThreshold */ 2, /* networkId */ customNetworkId);
    });

    it("Default parameters are set correctly", () => {
      assert.equal(gasEstimator.updateThreshold, 2);
      assert.equal(
        gasEstimator.defaultFastPriceGwei,
        GAS_ESTIMATOR_MAPPING_BY_NETWORK[customNetworkId].defaultFastPriceGwei,
        `defaultFastPriceGwei for networkId ${customNetworkId} incorrect`
      );
      assert.equal(gasEstimator.networkId, customNetworkId);
    });
    it("Updates if called after update threshold", async () => {
      await gasEstimator.update();
      const lastUpdateTimestamp = gasEstimator.lastUpdateTimestamp;
      await delay(3);
      await gasEstimator.update();
      assert(lastUpdateTimestamp < gasEstimator.lastUpdateTimestamp);
    });
    it("Defaults network ID if GAS_ESTIMATOR_MAPPING_BY_NETWORK missing network ID", async () => {
      const dummyLogger = winston.createLogger({
        level: "info",
        transports: [new winston.transports.Console()],
      });
      gasEstimator = new GasEstimator(
        dummyLogger,
        60,
        999 /* networkId that doesn't exist in GAS_ESTIMATOR_MAPPING_BY_NETWORK */
      );
      assert.equal(
        gasEstimator.defaultFastPriceGwei,
        GAS_ESTIMATOR_MAPPING_BY_NETWORK[1].defaultFastPriceGwei,
        "Should default to defaultFastPriceGwei for networkId 1"
      );
      assert.equal(gasEstimator.networkId, 1);
    });
  });
});
