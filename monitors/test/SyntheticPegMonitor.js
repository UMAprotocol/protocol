const { toWei, toBN } = web3.utils;
const winston = require("winston");
const sinon = require("sinon");

// Uniswap Price feed helpers
const { UniswapPriceFeed } = require("../../financial-templates-lib/price-feed/UniswapPriceFeed");
const { mineTransactionsAtTime } = require("../../common/SolidityTestUtils");
const { delay } = require("../../financial-templates-lib/helpers/delay");
const { MAX_SAFE_JS_INT } = require("../../common/Constants");

// Crypto watch price feed helpers
const { CryptoWatchPriceFeed } = require("../../financial-templates-lib/price-feed/CryptoWatchPriceFeed");
const { NetworkerMock } = require("../../financial-templates-lib/test/price-feed/NetworkerMock");

// Tested module
const { SyntheticPegMonitor } = require("../SyntheticPegMonitor");

// Custom winston transport module to monitor winston log outputs
const { SpyTransport, lastSpyLogIncludes } = require("../../financial-templates-lib/logger/SpyTransport");

// COntract artifacts to mock Uniswap
const UniswapMock = artifacts.require("UniswapMock");
const Uniswap = artifacts.require("Uniswap");

contract("SyntheticPegMonitor", function(accounts) {
  const owner = accounts[0];

  let uniswapPriceFeed;
  let cryptoWatchPriceFeed;
  let mockTime = 1588376548;
  let networker;
  let syntheticPegMonitor;

  const apiKey = "test-api-key";
  const exchange = "test-exchange";
  const pair = "test-pair";
  const lookback = 120; // 2 minutes.
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 60;

  let spy;
  let spyLogger;

  let syntheticPegMonitorConfig;

  // Set the most recent CryptoWatch price to a given value.
  const injectCryptoWatchLatestPrice = async injectPrice => {
    const validResponses = [
      {
        result: {
          "60": [
            [
              1588376400, // CloseTime
              1.1, // OpenPrice
              1.7, // HighPrice
              0.5, // LowPrice
              1.2, // ClosePrice
              281.73395575, // Volume
              2705497.370853147 // QuoteVolume
            ],
            [1588376460, 1.2, 1.8, 0.6, 1.3, 281.73395575, 2705497.370853147],
            [1588376520, 1.3, 1.9, 0.7, 1.4, 888.92215493, 8601704.133826157]
          ]
        }
      },
      {
        result: {
          price: injectPrice
        }
      }
    ];
    networker.getJsonReturns = [...validResponses];
  };

  // Inject a price into the uniswap market. Simulates new trading events.
  const injectUniswapLatestPrice = async injectPrice => {
    // Keeping the denominator fixed to 1 means that the resultant price is always the numerator.
    const denominator = toWei("1");
    const numerator = toWei(injectPrice.toString());
    await uniswapMock.setPrice(denominator, numerator);
  };

  spy = sinon.spy();

  beforeEach(async function() {
    uniswapMock = await UniswapMock.new({ from: owner });

    // Create a sinon spy and give it to the SpyTransport as the winston logger. Use this to check all winston logs.
    // Note that only `info` level messages are captured.
    spyLogger = winston.createLogger({
      level: "info",
      transports: [new SpyTransport({ level: "info" }, { spy: spy })]
    });

    // Uniswap Price feed
    uniswapPriceFeed = new UniswapPriceFeed(
      spyLogger,
      Uniswap.abi,
      web3,
      uniswapMock.address,
      60, // twapLength
      lookback,
      () => mockTime
    );

    // Crypto watch Price feed
    networker = new NetworkerMock();
    cryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      spyLogger,
      web3,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates
    );

    // Tested module that uses the two price feeds.
    syntheticPegMonitorConfig = {
      deviationAlertThreshold: 20 // Any deviation larger than 20% should fire an alert
    };
    syntheticPegMonitor = new SyntheticPegMonitor(spyLogger, uniswapPriceFeed, cryptoWatchPriceFeed);
  });
  it("Calculate percentage error returns expected values", async function() {
    // Test with simple values with know percentage error.
    assert.equal(
      syntheticPegMonitor._calculatePercentageError(toBN(toWei("1")), toBN(toWei("1"))).toString(),
      toBN(toWei("0")).toString()
    );
    assert.equal(
      syntheticPegMonitor._calculatePercentageError(toBN(toWei("1.11")), toBN(toWei("1"))).toString(),
      toBN(toWei("11")).toString()
    );
    assert.equal(
      syntheticPegMonitor._calculatePercentageError(toBN(toWei("1.25")), toBN(toWei("1"))).toString(),
      toBN(toWei("25")).toString()
    );

    // More aggressive test with local validation of the calculation.
    assert.equal(
      syntheticPegMonitor._calculatePercentageError(toBN(toWei("3.1415")), toBN(toWei("3.14159"))).toString(),
      toBN(toWei("3.1415")) // actual
        .sub(toBN(toWei("3.14159"))) // expected
        .mul(toBN(toWei("1"))) // Scale the numerator before division
        .div(toBN(toWei("3.14159"))) // expected
        .abs()
        .muln(100) // scale for percentage
        .toString()
    );
  });

  it("Correctly emits messages ", async function() {
    // Zero price deviation should not emit any events.
    // Inject prices to feeds
    await injectCryptoWatchLatestPrice(1);
    await injectUniswapLatestPrice(1);

    // Update price feeds.
    await uniswapPriceFeed.update();
    await cryptoWatchPriceFeed.update();

    // Check for price deviation from monitor module.
    await syntheticPegMonitor.checkPriceDeviation();
    assert.equal(spy.callCount, 0); // There should be no messages sent at this point.

    // Price deviation above the threshold of 20% should send a message.
    await injectCryptoWatchLatestPrice(1);
    await injectUniswapLatestPrice(1.25);
    await uniswapPriceFeed.update();
    await cryptoWatchPriceFeed.update();
    await syntheticPegMonitor.checkPriceDeviation();
    assert.equal(spy.callCount, 1); // There should be one message sent at this point.
    assert.isTrue(lastSpyLogIncludes(spy, "off peg alert"));
    assert.isTrue(lastSpyLogIncludes(spy, "1.25")); // uniswap price
    assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // expected price
    assert.isTrue(lastSpyLogIncludes(spy, "25.00")); // percentage error

    // Price deviation at the threshold of 20% should send a message.
    await injectCryptoWatchLatestPrice(1);
    await injectUniswapLatestPrice(1.2);
    await uniswapPriceFeed.update();
    await cryptoWatchPriceFeed.update();
    await syntheticPegMonitor.checkPriceDeviation();
    assert.equal(spy.callCount, 1); // There should be no new messages sent.

    // Price deviation below the threshold of 20% should send a message.
    await injectCryptoWatchLatestPrice(1);
    await injectUniswapLatestPrice(0.75);
    await uniswapPriceFeed.update();
    await cryptoWatchPriceFeed.update();
    await syntheticPegMonitor.checkPriceDeviation();
    assert.equal(spy.callCount, 2); // There should be one message sent at this point.
    assert.isTrue(lastSpyLogIncludes(spy, "off peg alert"));
    assert.isTrue(lastSpyLogIncludes(spy, "0.75")); // uniswap price
    assert.isTrue(lastSpyLogIncludes(spy, "1.00")); // expected price
    assert.isTrue(lastSpyLogIncludes(spy, "25.00")); // percentage error
  });
});
