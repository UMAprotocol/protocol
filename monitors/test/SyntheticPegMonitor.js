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

  let spy;
  let spylogger;

  let syntheticPegMonitorConfig;
  let syntheticPegMonitor;

  beforeEach(async function() {
    uniswapPriceFeedMock = new PriceFeedMock();
    medianizerPriceFeedMock = new PriceFeedMock();

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    // Note that only `info` level messages are captured.
    spy = sinon.spy(); // Create a new spy for each test.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });
  });

  describe("Synthetic price deviation from peg", function() {
    beforeEach(async function() {
      // Tested module that uses the two price feeds.
      syntheticPegMonitorConfig = {
        deviationAlertThreshold: toBN(toWei("0.2")) // Any deviation larger than 0.2 should fire an alert
      };
      syntheticPegMonitor = new SyntheticPegMonitor(
        spyLogger,
        web3,
        uniswapPriceFeedMock,
        medianizerPriceFeedMock,
        syntheticPegMonitorConfig
      );
    });

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
    beforeEach(async function() {
      // Tested module that uses the two price feeds.
      syntheticPegMonitorConfig = {
        volatilityWindow: 3650,
        // Not divisible by 3600 in order to test that "volatility window in hours" is printed
        // correctly by Logger.
        volatilityAlertThreshold: toBN(toWei("0.3"))
      };
      syntheticPegMonitor = new SyntheticPegMonitor(
        spyLogger,
        web3,
        uniswapPriceFeedMock,
        medianizerPriceFeedMock,
        syntheticPegMonitorConfig
      );
    });

    it("Calculate price volatility returns expected values", async function() {
      // Inject prices into pricefeed.
      const historicalPrices = [
        { timestamp: 100, price: toBN(toWei("10")) },
        { timestamp: 101, price: toBN(toWei("11")) },
        { timestamp: 102, price: toBN(toWei("12")) },
        { timestamp: 103, price: toBN(toWei("13")) },
        { timestamp: 104, price: toBN(toWei("14")) },
        { timestamp: 105, price: toBN(toWei("15")) },
        { timestamp: 106, price: toBN(toWei("16")) },
        { timestamp: 107, price: toBN(toWei("17")) }
      ];
      medianizerPriceFeedMock.setHistoricalPrices(historicalPrices);

      // Volatility window is 5, so historical volatility will be calculated 5 timestamps back of the last update time.
      const volatilityWindow = 5;

      // Test when volatility window is larger than the amount of historical prices. The last update time is 103,
      // so this should read the volatility from timestamps [103, 102, 102, and 100]. The min/max should be 10/13,
      // and the volatility should be (3 / 10 = 0.3) or 30%.
      medianizerPriceFeedMock.setLastUpdateTime(103);
      assert.equal(
        syntheticPegMonitor
          ._calculateHistoricalVolatility(medianizerPriceFeedMock, 103, volatilityWindow)
          .volatility.toString(),
        toBN(toWei("0.3")).toString()
      );

      // Test when volatility window captures only one historical price. The last update time is 100,
      // so this should read the volatility from timestamps [100]. The min/max should be 10/10,
      // and the volatility should be 0%.
      medianizerPriceFeedMock.setLastUpdateTime(100);
      assert.equal(
        syntheticPegMonitor
          ._calculateHistoricalVolatility(medianizerPriceFeedMock, 100, volatilityWindow)
          .volatility.toString(),
        "0"
      );

      // Test when volatility window captures only one historical price. The last update time is 200,
      // so this should read the volatility from no timestamps. This should return null.
      medianizerPriceFeedMock.setLastUpdateTime(200);
      assert.equal(
        syntheticPegMonitor._calculateHistoricalVolatility(medianizerPriceFeedMock, 200, volatilityWindow),
        null
      );

      // Test when volatility window is smaller than the amount of historical prices. The last update time is 106,
      // so this should read the volatility from timestamps [106, 105, 104, 103, 102]. The min/max should be 12/16,
      // and the volatility should be (4 / 12 = 0.3333) or 33%.
      medianizerPriceFeedMock.setLastUpdateTime(106);
      assert.equal(
        syntheticPegMonitor
          ._calculateHistoricalVolatility(medianizerPriceFeedMock, 106, volatilityWindow)
          .volatility.toString(),
        toBN(toWei("0.333333333333333333")).toString() // 18 3's is max that can be represented with Wei.
      );
    });

    it("Correctly emits messages", async function() {
      // Inject prices into pricefeed.
      const historicalPrices = [
        { timestamp: 100, price: toBN(toWei("10")) },
        { timestamp: 101, price: toBN(toWei("11")) },
        { timestamp: 102, price: toBN(toWei("12")) },
        { timestamp: 103, price: toBN(toWei("13")) },
        { timestamp: 104, price: toBN(toWei("14")) },
        { timestamp: 105, price: toBN(toWei("15")) },
        { timestamp: 106, price: toBN(toWei("16")) },
        { timestamp: 107, price: toBN(toWei("17")) }
      ];
      medianizerPriceFeedMock.setHistoricalPrices(historicalPrices);
      uniswapPriceFeedMock.setHistoricalPrices(historicalPrices);

      // Test when volatility is under threshold. Monitor should not emit any events.
      // Min/Max from time 103 should be 10/13, so volatility should be 3/10 = 30%, which is
      // not greater than the 30% threshold.
      medianizerPriceFeedMock.setLastUpdateTime(103);
      uniswapPriceFeedMock.setLastUpdateTime(103);
      await syntheticPegMonitor.checkPegVolatility();
      await syntheticPegMonitor.checkSyntheticVolatility();
      assert.equal(spy.callCount, 0); // There should be no messages sent at this point.

      // There should be one alert emitted for each pricefeed.

      // Test when volatility is over threshold. Monitor should emit an error message.
      // Min/Max from time 104 is 10/14, so volatility is 4/10 = 40%.
      medianizerPriceFeedMock.setLastUpdateTime(104);
      await syntheticPegMonitor.checkPegVolatility();
      assert.equal(spy.callCount, 1);
      assert.isTrue(lastSpyLogIncludes(spy, "peg price volatility alert"));
      assert.isTrue(lastSpyLogIncludes(spy, "14.00")); // latest pricefeed price
      assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
      assert.isTrue(lastSpyLogIncludes(spy, "40.00")); // actual volatility

      uniswapPriceFeedMock.setLastUpdateTime(104);
      await syntheticPegMonitor.checkSyntheticVolatility();
      assert.equal(spy.callCount, 2);
      assert.isTrue(lastSpyLogIncludes(spy, "synthetic price volatility alert"));
      assert.isTrue(lastSpyLogIncludes(spy, "14.00")); // latest pricefeed price
      assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
      assert.isTrue(lastSpyLogIncludes(spy, "40.00")); // actual volatility
    });

    it("Stress testing with a lot of historical price data points", async function() {
      // Inject prices into pricefeed.
      const historicalPrices = [];
      for (let i = 0; i < 10000; i++) {
        historicalPrices.push({ timestamp: i, price: toBN(toWei(i.toString())) });
      }
      medianizerPriceFeedMock.setHistoricalPrices(historicalPrices);
      uniswapPriceFeedMock.setHistoricalPrices(historicalPrices);

      medianizerPriceFeedMock.setLastUpdateTime(historicalPrices.length - 1);
      uniswapPriceFeedMock.setLastUpdateTime(historicalPrices.length - 1);

      // There should be one alert emitted for each pricefeed.
      // Max price will be 9999, min price will be (9999-3650+1) = 6350.
      // Vol will be 3649/6350 = 57.46%
      await syntheticPegMonitor.checkPegVolatility();
      assert.equal(spy.callCount, 1);
      assert.isTrue(lastSpyLogIncludes(spy, "peg price volatility alert"));
      assert.isTrue(lastSpyLogIncludes(spy, "9,999.00")); // latest pricefeed price
      assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
      assert.isTrue(lastSpyLogIncludes(spy, "57.46")); // actual volatility

      // uniswapPriceFeedMock.setLastUpdateTime(104);
      await syntheticPegMonitor.checkSyntheticVolatility();
      assert.equal(spy.callCount, 2);
      assert.isTrue(lastSpyLogIncludes(spy, "synthetic price volatility alert"));
      assert.isTrue(lastSpyLogIncludes(spy, "9,999.00")); // latest pricefeed price
      assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
      assert.isTrue(lastSpyLogIncludes(spy, "57.46")); // actual volatility
    });
  });
});
