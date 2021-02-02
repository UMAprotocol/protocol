const { toWei, toBN } = web3.utils;

const winston = require("winston");
const sinon = require("sinon");

const { parseFixed } = require("@uma/common");

// Tested module
const { SyntheticPegMonitor } = require("../src/SyntheticPegMonitor");

// Mock and custom winston transport module to monitor winston log outputs
const {
  PriceFeedMock,
  SpyTransport,
  lastSpyLogIncludes,
  lastSpyLogLevel,
  InvalidPriceFeedMock
} = require("@uma/financial-templates-lib");

// Run the tests against 2 diffrent price feed scaling combinations. Note these tests differ from the other monitor tests
// as the Synthetic peg monitor is only dependent on price feeds. No need to test different decimal or collateral combinations.
// 1) 18 decimal price feed.
// 2) 8 decimal price feed.
// 3) matching 8 collateral & 8 synthetic for current UMA synthetics.
const configs = [{ priceFeedDecimals: 18 }, { priceFeedDecimals: 8 }];

const Convert = decimals => number => toBN(parseFixed(number.toString(), decimals).toString());

contract("SyntheticPegMonitor", function() {
  for (let testConfig of configs) {
    describe(`${testConfig.priceFeedDecimals} pricefeed decimals`, function() {
      let uniswapPriceFeedMock;
      let medianizerPriceFeedMock;
      let invalidPriceFeedMock;
      let denominatorPriceFeedMock;

      let spy;
      let spyLogger;

      let monitorConfig;
      let empProps;
      let syntheticPegMonitor;

      let convertPrice;

      beforeEach(async function() {
        convertPrice = Convert(testConfig.priceFeedDecimals);

        uniswapPriceFeedMock = new PriceFeedMock(undefined, undefined, undefined, testConfig.priceFeedDecimals);
        medianizerPriceFeedMock = new PriceFeedMock(undefined, undefined, undefined, testConfig.priceFeedDecimals);
        invalidPriceFeedMock = new InvalidPriceFeedMock(undefined, undefined, undefined, testConfig.priceFeedDecimals);
        denominatorPriceFeedMock = new PriceFeedMock(undefined, undefined, undefined, testConfig.priceFeedDecimals);

        empProps = {
          syntheticSymbol: "SYNTH",
          priceIdentifier: "TEST_IDENTIFIER",
          priceFeedDecimals: testConfig.priceFeedDecimals
        };

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
          monitorConfig = {
            deviationAlertThreshold: 0.2 // Any deviation larger than 0.2 should fire an alert
          };

          syntheticPegMonitor = new SyntheticPegMonitor({
            logger: spyLogger,
            web3,
            uniswapPriceFeed: uniswapPriceFeedMock,
            medianizerPriceFeed: medianizerPriceFeedMock,
            monitorConfig,
            empProps
          });
        });

        it("Calculate percentage error returns expected values", async function() {
          // Test with simple values with know percentage error. Note that the output is scaled according to toWei (1e18).// This is because a deviation error is a unitless number and is scaled independently of the price scalling.
          assert.equal(
            syntheticPegMonitor._calculateDeviationError(convertPrice("1"), convertPrice("1")).toString(),
            toBN(toWei("0").toString())
          );
          assert.equal(
            syntheticPegMonitor._calculateDeviationError(convertPrice("1.11"), convertPrice("1")).toString(),
            toBN(toWei("0.11")).toString()
          );
          assert.equal(
            syntheticPegMonitor._calculateDeviationError(convertPrice("1.25"), convertPrice("1")).toString(),
            toBN(toWei("0.25")).toString()
          );

          // More aggressive test with local validation of the calculation.
          assert.equal(
            syntheticPegMonitor._calculateDeviationError(convertPrice("3.1415"), convertPrice("3.14159")).toString(),
            toBN(toWei("3.1415")) // actual
              .sub(toBN(toWei("3.14159"))) // expected
              .mul(toBN(toWei("1"))) // Scale the numerator before division
              .div(toBN(toWei("3.14159"))) // expected
              .toString()
          );
        });

        it("Correctly emits messages", async function() {
          // Zero price deviation should not emit any events.
          // Inject prices to feeds
          medianizerPriceFeedMock.setCurrentPrice(convertPrice("1"));
          uniswapPriceFeedMock.setCurrentPrice(convertPrice("1"));

          // Check for price deviation from monitor module.
          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 0); // There should be no messages sent at this point.

          // Price deviation above the threshold of 20% should send a message.
          medianizerPriceFeedMock.setCurrentPrice(convertPrice("1"));
          uniswapPriceFeedMock.setCurrentPrice(convertPrice("1.25"));
          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 1); // There should be one message sent at this point.
          assert.isTrue(lastSpyLogIncludes(spy, "off peg alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "1.25")); // uniswap price
          assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // expected price
          assert.isTrue(lastSpyLogIncludes(spy, "25.00")); // percentage error
          assert.equal(lastSpyLogLevel(spy), "warn");

          // Price deviation at the threshold of 20% should send a message.
          medianizerPriceFeedMock.setCurrentPrice(convertPrice("1"));
          uniswapPriceFeedMock.setCurrentPrice(convertPrice("1.2"));
          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 1); // There should be no new messages sent.

          // Price deviation below the threshold of 20% should send a message.
          medianizerPriceFeedMock.setCurrentPrice(convertPrice("1"));
          uniswapPriceFeedMock.setCurrentPrice(convertPrice("0.7"));
          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 2); // There should be one message sent at this point.
          assert.isTrue(lastSpyLogIncludes(spy, "off peg alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "0.7000")); // uniswap price
          assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // expected price
          assert.isTrue(lastSpyLogIncludes(spy, "-30.00")); // percentage error (note negative sign)
          assert.equal(lastSpyLogLevel(spy), "warn");

          // Small values (<0.1) should be scaled correctly in logs.
          medianizerPriceFeedMock.setCurrentPrice(convertPrice("0.021111")); // Note 5 units of precision provided.
          uniswapPriceFeedMock.setCurrentPrice(convertPrice("0.025678")); // Note 5 units of precision provided.
          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 3); // There should be one message sent at this point.
          assert.isTrue(lastSpyLogIncludes(spy, "off peg alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "0.02567")); // uniswap price (note: 4 units of precision)
          assert.isTrue(lastSpyLogIncludes(spy, "0.02111")); // expected price (note: 4 units of precision)
          assert.isTrue(lastSpyLogIncludes(spy, "21.63")); // percentage error
          assert.equal(lastSpyLogLevel(spy), "warn");
        });

        it("Does not track price deviation if threshold set to zero", async function() {
          monitorConfig = {
            deviationAlertThreshold: 0 // No alerts should be fired, irrespective of the current price deviation.
          };

          syntheticPegMonitor = new SyntheticPegMonitor({
            logger: spyLogger,
            web3,
            uniswapPriceFeed: uniswapPriceFeedMock,
            medianizerPriceFeed: medianizerPriceFeedMock,
            monitorConfig,
            empProps
          });

          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 0); // There should be no messages sent.

          // Create a price deviation of 25% and validate that no messages are sent.
          medianizerPriceFeedMock.setCurrentPrice(convertPrice("1"));
          uniswapPriceFeedMock.setCurrentPrice(convertPrice("1.25"));
          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 0); // There should be no messages sent.
        });

        it("Divides by denominator price feed", async function() {
          // Create a new monitor with the denominatorPriceFeed set
          syntheticPegMonitor = new SyntheticPegMonitor({
            logger: spyLogger,
            web3,
            uniswapPriceFeed: uniswapPriceFeedMock,
            medianizerPriceFeed: medianizerPriceFeedMock,
            denominatorPriceFeed: denominatorPriceFeedMock,
            monitorConfig,
            empProps
          });

          // Denominator price set to 1, should produce 0 deviation.
          medianizerPriceFeedMock.setCurrentPrice(convertPrice("1"));
          uniswapPriceFeedMock.setCurrentPrice(convertPrice("1"));
          denominatorPriceFeedMock.setCurrentPrice(convertPrice("1"));

          // Check for price deviation from monitor module.
          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 0); // There should be no messages sent at this point.

          // Setting denominator to 2 should produce -50% deviation because it divides the uniswap price by 2
          denominatorPriceFeedMock.setCurrentPrice(convertPrice("2"));
          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 1); // There should be one message sent at this point.
          assert.isTrue(lastSpyLogIncludes(spy, "off peg alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "0.50")); // uniswap price
          assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // expected price
          assert.isTrue(lastSpyLogIncludes(spy, "-50.00")); // percentage error
          assert.equal(lastSpyLogLevel(spy), "warn");
        });
      });

      describe("Pricefeed volatility", function() {
        beforeEach(async function() {
          // Tested module that uses the two price feeds.
          monitorConfig = {
            volatilityWindow: 3650,
            // Not divisible by 3600 in order to test that "volatility window in hours" is printed
            // correctly by Logger.
            pegVolatilityAlertThreshold: 0.3,
            syntheticVolatilityAlertThreshold: 0.3
          };

          syntheticPegMonitor = new SyntheticPegMonitor({
            logger: spyLogger,
            web3,
            uniswapPriceFeed: uniswapPriceFeedMock,
            medianizerPriceFeed: medianizerPriceFeedMock,
            monitorConfig,
            empProps
          });
        });

        it("Calculate price volatility returns expected values", async function() {
          // Inject prices into pricefeed. Null prices are ignored.
          const historicalPrices = [
            { timestamp: 99, price: null },
            { timestamp: 100, price: convertPrice("10") },
            { timestamp: 101, price: convertPrice("11") },
            { timestamp: 102, price: convertPrice("12") },
            { timestamp: 103, price: convertPrice("13") },
            { timestamp: 104, price: convertPrice("14") },
            { timestamp: 105, price: convertPrice("15") },
            { timestamp: 106, price: convertPrice("16") },
            { timestamp: 107, price: null },
            { timestamp: 108, price: convertPrice("17") },
            { timestamp: 109, price: null }
          ];
          medianizerPriceFeedMock.setHistoricalPrices(historicalPrices);

          // Volatility window is 5, so historical volatility will be calculated 5 timestamps back of the last update time.
          const volatilityWindow = 5;

          // Test when volatility window is larger than the amount of historical prices. The last update time is 103,
          // so this should read the volatility from timestamps [103, 102, 102, and 100]. The min/max should be 10/13,
          // and the volatility should be (3 / 10 = 0.3) or 30%. Note that the output is scaled according to toWei (1e18).// This is because a volitility is a unitless number and is scaled independently of the price scalling.
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
          // so this should read the volatility from no timestamps. This should throw.
          medianizerPriceFeedMock.setLastUpdateTime(200);
          assert.throws(() =>
            syntheticPegMonitor._calculateHistoricalVolatility(medianizerPriceFeedMock, 200, volatilityWindow)
          );

          // Test when volatility window is smaller than the amount of historical prices. The last update time is 106,
          // so this should read the volatility from timestamps [106, 105, 104, 103, 102]. The min/max should be 12/16,
          // and the volatility should be (4 / 12 = 0.3333) or 33%.
          medianizerPriceFeedMock.setLastUpdateTime(107);
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
            { timestamp: 100, price: convertPrice("10") },
            { timestamp: 101, price: convertPrice("11") },
            { timestamp: 102, price: convertPrice("12") },
            { timestamp: 103, price: convertPrice("13") },
            { timestamp: 104, price: convertPrice("14") }, // Increasing price until timestamp 104
            { timestamp: 105, price: convertPrice("13") },
            { timestamp: 106, price: convertPrice("12") },
            { timestamp: 107, price: convertPrice("11") },
            { timestamp: 108, price: convertPrice("10") } // Decreasing price until timestamp 108
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
          assert.isTrue(lastSpyLogIncludes(spy, "Peg price volatility alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "14.00")); // latest pricefeed price
          assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
          assert.isTrue(lastSpyLogIncludes(spy, "40.00")); // actual volatility
          assert.isTrue(lastSpyLogIncludes(spy, "30")); // volatility threshold parameter

          uniswapPriceFeedMock.setLastUpdateTime(104);
          await syntheticPegMonitor.checkSyntheticVolatility();
          assert.equal(spy.callCount, 2);
          assert.isTrue(lastSpyLogIncludes(spy, "Synthetic price volatility alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "14.00")); // latest pricefeed price
          assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
          assert.isTrue(lastSpyLogIncludes(spy, "40.00")); // actual volatility
          assert.isTrue(lastSpyLogIncludes(spy, "30")); // volatility threshold parameter

          // Correctly reports negative volatility. The last 4 sets of time series data move in the opposite direction.
          // Logger should correctly report the negative swing.
          medianizerPriceFeedMock.setLastUpdateTime(108);
          await syntheticPegMonitor.checkPegVolatility();
          assert.equal(spy.callCount, 3);
          assert.isTrue(lastSpyLogIncludes(spy, "Peg price volatility alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "10.00")); // latest pricefeed price
          assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
          assert.isTrue(lastSpyLogIncludes(spy, "-40.00")); // actual volatility (note the negative sign)
          assert.isTrue(lastSpyLogIncludes(spy, "30")); // volatility threshold parameter

          uniswapPriceFeedMock.setLastUpdateTime(108);
          await syntheticPegMonitor.checkSyntheticVolatility();
          assert.equal(spy.callCount, 4);
          assert.isTrue(lastSpyLogIncludes(spy, "Synthetic price volatility alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "10.00")); // latest pricefeed price
          assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
          assert.isTrue(lastSpyLogIncludes(spy, "-40.00")); // actual volatility
          assert.isTrue(lastSpyLogIncludes(spy, "30")); // volatility threshold parameter
        });

        it("Sends detailed error message when missing volatility data", async function() {
          // Test that the SyntheticPegMonitor correctly bubbles up PriceFeed errors.
          syntheticPegMonitor = new SyntheticPegMonitor({
            logger: spyLogger,
            web3,
            uniswapPriceFeed: invalidPriceFeedMock,
            medianizerPriceFeed: invalidPriceFeedMock,
            monitorConfig: {},
            empProps
          });

          // Test when no update time in the price feed is set.
          await syntheticPegMonitor.checkPegVolatility();
          assert.isTrue(lastSpyLogIncludes(spy, "missing historical price data"));
          assert.isTrue(lastSpyLogIncludes(spy, "0")); // historical time defaults to 0
          assert.isTrue(lastSpyLogIncludes(spy, "600")); // lookback window for which we cannot retrieve price data for

          await syntheticPegMonitor.checkSyntheticVolatility();
          assert.isTrue(lastSpyLogIncludes(spy, "missing historical price data"));
          assert.isTrue(lastSpyLogIncludes(spy, "0")); // historical time defaults to 0
          assert.isTrue(lastSpyLogIncludes(spy, "600")); // lookback window for which we cannot retrieve price data for

          // Test when update time is set.
          invalidPriceFeedMock.setLastUpdateTime(999);

          await syntheticPegMonitor.checkPegVolatility();
          assert.isTrue(lastSpyLogIncludes(spy, "missing historical price data"));
          assert.isTrue(lastSpyLogIncludes(spy, "600")); // lookback window for which we cannot retrieve price data for
          assert.ok(spy.getCall(-1).lastArg.error); // error logs should not be undefined.

          await syntheticPegMonitor.checkSyntheticVolatility();
          assert.isTrue(lastSpyLogIncludes(spy, "missing historical price data"));
          assert.isTrue(lastSpyLogIncludes(spy, "600")); // lookback window for which we cannot retrieve price data for
          assert.ok(spy.getCall(-1).lastArg.error); // error logs should not be undefined.
        });

        it("Stress testing with a lot of historical price data points", async function() {
          // Inject prices into pricefeed.
          const historicalPrices = [];
          for (let i = 0; i < 10000; i++) {
            historicalPrices.push({ timestamp: i, price: convertPrice(i.toString()) });
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
          assert.isTrue(lastSpyLogIncludes(spy, "Peg price volatility alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "9,999.00")); // latest pricefeed price
          assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
          assert.isTrue(lastSpyLogIncludes(spy, "57.46")); // actual volatility

          // uniswapPriceFeedMock.setLastUpdateTime(104);
          await syntheticPegMonitor.checkSyntheticVolatility();
          assert.equal(spy.callCount, 2);
          assert.isTrue(lastSpyLogIncludes(spy, "Synthetic price volatility alert"));
          assert.isTrue(lastSpyLogIncludes(spy, "9,999.00")); // latest pricefeed price
          assert.isTrue(lastSpyLogIncludes(spy, "1.01")); // volatility window in hours (i.e. 3650/3600)
          assert.isTrue(lastSpyLogIncludes(spy, "57.46")); // actual volatility
        });
        it("Does not track price volatility if threshold set to zero", async function() {
          monitorConfig = {
            volatilityWindow: 60,
            pegVolatilityAlertThreshold: 0,
            syntheticVolatilityAlertThreshold: 0
          };

          syntheticPegMonitor = new SyntheticPegMonitor({
            logger: spyLogger,
            web3,
            uniswapPriceFeed: uniswapPriceFeedMock,
            medianizerPriceFeed: medianizerPriceFeedMock,
            monitorConfig,
            empProps
          });

          // Inject prices into pricefeed.
          const historicalPrices = [
            { timestamp: 100, price: convertPrice("10") },
            { timestamp: 101, price: convertPrice("11") },
            { timestamp: 102, price: convertPrice("12") },
            { timestamp: 103, price: convertPrice("13") },
            { timestamp: 104, price: convertPrice("14") } // Increasing price until timestamp 104
          ];
          medianizerPriceFeedMock.setHistoricalPrices(historicalPrices);
          uniswapPriceFeedMock.setHistoricalPrices(historicalPrices);

          // Test when volatility is over threshold. Monitor should emit an no error message as threshold set to 0.
          // Min/Max from time 104 is 10/14, so volatility is 4/10 = 40%. First test peg volatility.
          medianizerPriceFeedMock.setLastUpdateTime(104);
          await syntheticPegMonitor.checkPegVolatility();
          assert.equal(spy.callCount, 0); // No longs should be sent as monitor threshold set to 0.

          // Next, test synthetic volatility.
          await syntheticPegMonitor.checkSyntheticVolatility();
          assert.equal(spy.callCount, 0); // No longs should be sent as monitor threshold set to 0.
        });
      });
      describe("Overrides the default monitor configuration settings", function() {
        it("Cannot set invalid config", async function() {
          let errorThrown1;
          try {
            // Create an invalid config. A valid config expects  1 > deviationAlertThreshold >=0, volatilityWindow >=0,
            // 1 > pegVolatilityAlertThreshold >= 0, 1 > syntheticVolatilityAlertThreshold >= 0.
            const invalidConfig1 = {
              // Invalid as deviationAlertThreshold set to above 1.
              deviationAlertThreshold: 1.5,
              volatilityWindow: 0,
              pegVolatilityAlertThreshold: 0,
              syntheticVolatilityAlertThreshold: 0
            };
            syntheticPegMonitor = new SyntheticPegMonitor({
              logger: spyLogger,
              web3,
              uniswapPriceFeed: uniswapPriceFeedMock,
              medianizerPriceFeed: medianizerPriceFeedMock,
              monitorConfig: invalidConfig1,
              empProps
            });
            errorThrown1 = false;
          } catch (err) {
            errorThrown1 = true;
          }
          assert.isTrue(errorThrown1);

          let errorThrown2;
          try {
            const invalidConfig2 = {
              // Invalid as volatilityWindow set to -1 && pegVolatilityAlertThreshold set to null.
              deviationAlertThreshold: 0,
              volatilityWindow: -1,
              pegVolatilityAlertThreshold: null,
              syntheticVolatilityAlertThreshold: 0
            };
            syntheticPegMonitor = new SyntheticPegMonitor({
              logger: spyLogger,
              web3,
              uniswapPriceFeed: uniswapPriceFeedMock,
              medianizerPriceFeed: medianizerPriceFeedMock,
              monitorConfig: invalidConfig2,
              empProps
            });
            errorThrown2 = false;
          } catch (err) {
            errorThrown2 = true;
          }
          assert.isTrue(errorThrown2);
        });
        it("Can correctly create synthetic peg monitor with no config provided", async function() {
          let errorThrown;
          try {
            // Create an invalid config. A valid config expects two arrays of addresses.
            const emptyConfig = {};
            syntheticPegMonitor = new SyntheticPegMonitor({
              logger: spyLogger,
              web3,
              uniswapPriceFeed: uniswapPriceFeedMock,
              medianizerPriceFeed: medianizerPriceFeedMock,
              monitorConfig: emptyConfig,
              empProps
            });
            await syntheticPegMonitor.checkPriceDeviation();
            await syntheticPegMonitor.checkPegVolatility();
            await syntheticPegMonitor.checkSyntheticVolatility();
            errorThrown = false;
          } catch (err) {
            errorThrown = true;
          }
          assert.isFalse(errorThrown);
        });
        it("Cannot set invalid alerting overrides", async function() {
          let errorThrown;
          try {
            // Create an invalid log level override. This should be rejected.
            const invalidConfig = { logOverrides: { deviation: "not a valid log level" } };
            syntheticPegMonitor = new SyntheticPegMonitor({
              logger: spyLogger,
              web3,
              uniswapPriceFeed: uniswapPriceFeedMock,
              medianizerPriceFeed: medianizerPriceFeedMock,
              monitorConfig: invalidConfig,
              empProps
            });

            errorThrown = false;
          } catch (err) {
            errorThrown = true;
          }
          assert.isTrue(errorThrown);
        });
        it("Overriding threshold correctly effects generated logs", async function() {
          const alertOverrideConfig = { logOverrides: { deviation: "error" } };
          syntheticPegMonitor = new SyntheticPegMonitor({
            logger: spyLogger,
            web3,
            uniswapPriceFeed: uniswapPriceFeedMock,
            medianizerPriceFeed: medianizerPriceFeedMock,
            monitorConfig: alertOverrideConfig,
            empProps
          });

          // Price deviation above the threshold of 20% should send a message.
          medianizerPriceFeedMock.setCurrentPrice(convertPrice("1"));
          uniswapPriceFeedMock.setCurrentPrice(convertPrice("1.25"));
          await syntheticPegMonitor.checkPriceDeviation();
          assert.equal(spy.callCount, 1); // There should be one message sent at this point.
          assert.equal(lastSpyLogLevel(spy), "error");
        });
      });
    });
  }
});
