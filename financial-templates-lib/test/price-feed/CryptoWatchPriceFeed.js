const { CryptoWatchPriceFeed } = require("../../price-feed/CryptoWatchPriceFeed");
const { NetworkerMock } = require("./NetworkerMock");
const winston = require("winston");

contract("CryptoWatchPriceFeed.js", function(accounts) {
  let cryptoWatchPriceFeed;
  let mockTime = 1588376548;
  let networker;

  const apiKey = "test-api-key";
  const exchange = "test-exchange";
  const pair = "test-pair";
  const lookback = 120; // 2 minutes.
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 60;

  const { toBN, toWei } = web3.utils;

  // Fake data to inject.
  // Note: the first element is the historical data and the second is the price. There's a lot of magic numbers here,
  // but with price data, it may be more confusing to attempt to name them all.
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
        price: 1.5
      }
    }
  ];

  beforeEach(async function() {
    networker = new NetworkerMock();
    const dummyLogger = winston.createLogger({
      level: "info",
      transports: []
    });
    cryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      web3,
      dummyLogger,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates
    );
  });

  it("No update", async function() {
    assert.equal(cryptoWatchPriceFeed.getCurrentPrice(), undefined);
    assert.equal(cryptoWatchPriceFeed.getHistoricalPrice(1000), undefined);
    assert.equal(cryptoWatchPriceFeed.getLastUpdateTime(), undefined);
  });

  it("Basic historical price", async function() {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await cryptoWatchPriceFeed.update();

    // Before period 1 should return null.
    assert.equal(cryptoWatchPriceFeed.getHistoricalPrice(1588376339), null);

    // During period 1.
    assert.equal(cryptoWatchPriceFeed.getHistoricalPrice(1588376340).toString(), toWei("1.1"));

    // During period 2.
    assert.equal(cryptoWatchPriceFeed.getHistoricalPrice(1588376405).toString(), toWei("1.2"));

    // During period 3.
    assert.equal(cryptoWatchPriceFeed.getHistoricalPrice(1588376515).toString(), toWei("1.3"));

    // After period 3 should return the most recent price.
    assert.equal(cryptoWatchPriceFeed.getHistoricalPrice(1588376521).toString(), toWei("1.5"));
  });

  it("Basic current price", async function() {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await cryptoWatchPriceFeed.update();

    // Should return the current price in the data.
    assert.equal(cryptoWatchPriceFeed.getCurrentPrice().toString(), toWei("1.5"));
  });

  it("Last update time", async function() {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await cryptoWatchPriceFeed.update();

    // Should return the mock time.
    assert.equal(cryptoWatchPriceFeed.getLastUpdateTime(), mockTime);
  });

  it("No or bad response", async function() {
    // Bad price response.
    networker.getJsonReturns = [
      {
        result: {
          "60": [] // Valid response, just no data points.
        }
      },
      {
        result: {
          error: "test"
        }
      }
    ];

    await cryptoWatchPriceFeed.update();

    assert.equal(cryptoWatchPriceFeed.getCurrentPrice(), undefined);
    assert.equal(cryptoWatchPriceFeed.getHistoricalPrice(1588376515), undefined);

    // Bad historical ohlc response.
    networker.getJsonReturns = [
      {
        error: "test"
      },
      {
        result: {
          price: 15.1
        }
      }
    ];

    await cryptoWatchPriceFeed.update();

    assert.equal(cryptoWatchPriceFeed.getCurrentPrice(), undefined);
    assert.equal(cryptoWatchPriceFeed.getHistoricalPrice(1588376515), undefined);
  });

  it("Update frequency", async function() {
    networker.getJsonReturns = [...validResponses];

    await cryptoWatchPriceFeed.update();

    networker.getJsonReturns = [...validResponses];

    // Update the return price to ensure it new data doesn't show up in the output.
    networker.getJsonReturns[1].result.price = 1.4;

    const originalMockTime = mockTime;
    mockTime += minTimeBetweenUpdates - 1;

    await cryptoWatchPriceFeed.update();
    assert.equal(cryptoWatchPriceFeed.getLastUpdateTime(), originalMockTime);
    assert.equal(cryptoWatchPriceFeed.getCurrentPrice().toString(), toWei("1.5"));
  });
});
