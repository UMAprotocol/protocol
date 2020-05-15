const { toWei, toBN } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");

// Price feed mock.
const { PriceFeedMock } = require("../../financial-templates-lib/test/price-feed/PriceFeedMock.js");

// Tested module
const { SyntheticPegMonitor } = require("../SyntheticPegMonitor");

// Custom winston transport module to monitor winston log outputs
const { SpyTransport, lastSpyLogIncludes } = require("../../financial-templates-lib/logger/SpyTransport");

contract("SyntheticPegMonitor", function(accounts) {
  let uniswapPriceFeedMock;
  let medianizerPriceFeedMock;

  spy = sinon.spy();

  beforeEach(async function() {
    uniswapPriceFeedMock = new PriceFeedMock();
    medianizerPriceFeedMock = new PriceFeedMock();

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    // Note that only `info` level messages are captured.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    // Tested module that uses the two price feeds.
    syntheticPegMonitorConfig = {
      deviationAlertThreshold: toBN(toWei("0.2")), // Any deviation larger than 0.2 should fire an alert
      volatilityWindow: 5, // Small window for testing
      volatilityAlertThreshold: toBN(toWei("0.05"))
    };
    syntheticPegMonitor = new SyntheticPegMonitor(
      spyLogger,
      web3,
      uniswapPriceFeedMock,
      medianizerPriceFeedMock,
      syntheticPegMonitorConfig
    );
  });

  describe("Synthetic price deviation from peg", function() {
    it("Calculate percentage error returns expected values", async function() {
      // Test with simple values with know percentage error.
      assert.equal(
        syntheticPegMonitor._calculateDeviationError(toBN(toWei("1")), toBN(toWei("1"))).toString(),
        toBN(toWei("0")).toString()
      );
      assert.equal(
        syntheticPegMonitor._calculateDeviationError(toBN(toWei("1.11")), toBN(toWei("1"))).toString(),
        toBN(toWei("0.11")).toString()
      );
      assert.equal(
        syntheticPegMonitor._calculateDeviationError(toBN(toWei("1.25")), toBN(toWei("1"))).toString(),
        toBN(toWei("0.25")).toString()
      );

      // More aggressive test with local validation of the calculation.
      assert.equal(
        syntheticPegMonitor._calculateDeviationError(toBN(toWei("3.1415")), toBN(toWei("3.14159"))).toString(),
        toBN(toWei("3.1415")) // actual
          .sub(toBN(toWei("3.14159"))) // expected
          .mul(toBN(toWei("1"))) // Scale the numerator before division
          .div(toBN(toWei("3.14159"))) // expected
          .abs()
          .toString()
      );
    });

    it("Correctly emits messages", async function() {
      // Zero price deviation should not emit any events.
      // Inject prices to feeds
      medianizerPriceFeedMock.setCurrentPrice(toBN(toWei("1")));
      uniswapPriceFeedMock.setCurrentPrice(toBN(toWei("1")));

      // Check for price deviation from monitor module.
      await syntheticPegMonitor.checkPriceDeviation();
      assert.equal(spy.callCount, 0); // There should be no messages sent at this point.

      // Price deviation above the threshold of 20% should send a message.
      medianizerPriceFeedMock.setCurrentPrice(toBN(toWei("1")));
      uniswapPriceFeedMock.setCurrentPrice(toBN(toWei("1.25")));
      await syntheticPegMonitor.checkPriceDeviation();
      assert.equal(spy.callCount, 1); // There should be one message sent at this point.
      assert.isTrue(lastSpyLogIncludes(spy, "off peg alert"));
      assert.isTrue(lastSpyLogIncludes(spy, "1.25")); // uniswap price
      assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // expected price
      assert.isTrue(lastSpyLogIncludes(spy, "25.00")); // percentage error

      // Price deviation at the threshold of 20% should send a message.
      medianizerPriceFeedMock.setCurrentPrice(toBN(toWei("1")));
      uniswapPriceFeedMock.setCurrentPrice(toBN(toWei("1.2")));
      await syntheticPegMonitor.checkPriceDeviation();
      assert.equal(spy.callCount, 1); // There should be no new messages sent.

      // Price deviation below the threshold of 20% should send a message.
      medianizerPriceFeedMock.setCurrentPrice(toBN(toWei("1")));
      uniswapPriceFeedMock.setCurrentPrice(toBN(toWei("0.7")));
      await syntheticPegMonitor.checkPriceDeviation();
      assert.equal(spy.callCount, 2); // There should be one message sent at this point.
      assert.isTrue(lastSpyLogIncludes(spy, "off peg alert"));
      assert.isTrue(lastSpyLogIncludes(spy, "0.7")); // uniswap price
      assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // expected price
      assert.isTrue(lastSpyLogIncludes(spy, "30.00")); // percentage error
    });
  });

  describe("Pricefeed volatility", function() {
    it("Calculate price volatility returns expected values", async function() {
      // Inject prices into pricefeed.
      const latestTime = medianizerPriceFeedMock.getLatestTime();

      assert.equal(
        syntheticPegMonitor._calculateHistoricalVolatility(medianizerPriceFeedMock, latestTime, 3).toString(),
        toBN(toWei("0.05")).toString()
      );
    });

    it("Correctly emits messages", async function() {});
  });
});
