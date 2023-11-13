const { assert } = require("chai");
const winston = require("winston");
// Helper
const { delay } = require("@uma/logger");

// Script to test
const { GasEstimator, MAPPING_BY_NETWORK } = require("../../dist/helpers/GasEstimator");

describe("GasEstimator.js", function () {
  let gasEstimator;

  describe("Construction with default config (london)", () => {
    // These tests validate the post london setup.
    beforeEach(() => {
      const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
      gasEstimator = new GasEstimator(dummyLogger);
    });

    it("Default parameters are set correctly", () => {
      assert(gasEstimator.updateThreshold > 0);
      assert.equal(
        gasEstimator.defaultMaxFeePerGasGwei,
        MAPPING_BY_NETWORK[1].defaultMaxFeePerGasGwei,
        "defaultMaxFeePerGasGwei for networkId 1 incorrect"
      );
      assert.equal(
        gasEstimator.defaultMaxPriorityFeePerGas,
        MAPPING_BY_NETWORK[1].defaultMaxPriorityFeePerGas,
        "defaultMaxPriorityFeePerGas for networkId 1 incorrect"
      );
      assert.equal(gasEstimator.networkId, 1, "default networkId should be 1");
    });
    it("Returns gas prices in wei before initial update", () => {
      assert.equal(gasEstimator.defaultMaxFeePerGasGwei, gasEstimator.getCurrentFastPrice().maxFeePerGas / 1e9);
      assert.equal(
        gasEstimator.latestMaxPriorityFeePerGasGwei,
        gasEstimator.getCurrentFastPrice().maxPriorityFeePerGas / 1e9
      );
    });
    it("Returns gas prices in wei after update", async () => {
      await gasEstimator.update();
      const latestMaxFeePerGas = gasEstimator.getCurrentFastPrice().maxFeePerGas / 1e9;
      if (latestMaxFeePerGas === gasEstimator.defaultMaxFeePerGasGwei) {
        console.log(`API Request to ethgasstation.info failed, using default gas price in Gwei: ${latestMaxFeePerGas}`);
      }
      assert(latestMaxFeePerGas > 0);

      const latestMaxPriorityFeePerGasGwei = gasEstimator.getCurrentFastPrice().maxFeePerGas / 1e9;
      if (latestMaxPriorityFeePerGasGwei === gasEstimator.maxPriorityFeePerGas) {
        console.log(
          `API Request to ethgasstation.info failed, using default gas price in Gwei: ${latestMaxPriorityFeePerGasGwei}`
        );
      }
      assert(latestMaxPriorityFeePerGasGwei > 0);
    });
    it("Does not update if called before update threshold", async () => {
      await gasEstimator.update();
      const lastUpdateTimestamp = gasEstimator.lastUpdateTimestamp;
      await delay(1);
      await gasEstimator.update();
      assert.equal(lastUpdateTimestamp, gasEstimator.lastUpdateTimestamp);
    });
  });

  describe("Construction with custom config (legacy)", () => {
    // These tests validate the legacy (pre EIP-1559) setup on custom network IDs
    // Choose a network ID specified in MAPPING_BY_NETWORK.
    const customNetworkId = 42161;

    beforeEach(() => {
      const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
      gasEstimator = new GasEstimator(dummyLogger, /* updateThreshold */ 2, /* networkId */ customNetworkId);
    });

    it("Default parameters are set correctly", () => {
      assert.equal(gasEstimator.updateThreshold, 2);
      assert.equal(
        gasEstimator.defaultFastPriceGwei,
        MAPPING_BY_NETWORK[customNetworkId].defaultFastPriceGwei,
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
    it("Defaults network ID if MAPPING_BY_NETWORK missing network ID", async () => {
      const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
      gasEstimator = new GasEstimator(dummyLogger, 60, 999 /* networkId that doesn't exist in MAPPING_BY_NETWORK */);
      assert.equal(gasEstimator.defaultMaxFeePerGasGwei, MAPPING_BY_NETWORK[1].defaultMaxFeePerGasGwei);
      assert.equal(gasEstimator.defaultMaxPriorityFeePerGasGwei, MAPPING_BY_NETWORK[1].defaultMaxPriorityFeePerGasGwei);
      assert.equal(gasEstimator.networkId, 1);
    });
  });
});
