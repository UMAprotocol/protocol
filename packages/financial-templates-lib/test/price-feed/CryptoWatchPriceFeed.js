const { CryptoWatchPriceFeed } = require("../../src/price-feed/CryptoWatchPriceFeed");
const { NetworkerMock } = require("../../src/price-feed/NetworkerMock");
const winston = require("winston");

contract("CryptoWatchPriceFeed.js", function () {
  let cryptoWatchPriceFeed;
  let invertedCryptoWatchPriceFeed;
  let mockTime = 1588376548;
  let networker;
  let dummyLogger;

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
        60: [
          [
            1588376400, // CloseTime
            1.1, // OpenPrice
            1.7, // HighPrice
            0.5, // LowPrice
            1.2, // ClosePrice
            281.73395575, // Volume
            2705497.370853147, // QuoteVolume
          ],
          [1588376460, 1.2, 1.8, 0.6, 1.3, 281.73395575, 2705497.370853147],
          [1588376520, 1.3, 1.9, 0.7, 1.4, 888.92215493, 8601704.133826157],
        ],
      },
    },
    {
      result: {
        price: 1.5,
      },
    },
  ];

  beforeEach(async function () {
    networker = new NetworkerMock();
    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()],
    });
    cryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      18 // Prove that this will not break existing functionality
    );
    invertedCryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      true,
      10 // Add arbitrary decimal conversion and prove this works.
    );
  });

  it("Inverted current price", async function () {
    networker.getJsonReturns = [...validResponses];
    await invertedCryptoWatchPriceFeed.update();

    assert.equal(
      // Should be equal to: toWei(1/1.5)
      invertedCryptoWatchPriceFeed.getCurrentPrice().toString(),
      toBN(toWei("1"))
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("1.5")))
        // we need this last division to convert final result to correct decimals
        // in this case its from 18 decimals to 10 decimals.
        // You will see this in the rest of the inverted tests.
        .div(toBN("10").pow(toBN(18 - 10)))
        .toString()
    );
  });

  it("Inverted historical price", async function () {
    networker.getJsonReturns = [...validResponses];
    await invertedCryptoWatchPriceFeed.update();

    // Before period 1 should fail.
    assert.isTrue(await invertedCryptoWatchPriceFeed.getHistoricalPrice(1588376339).catch(() => true));

    // During period 1.
    assert.equal(
      // Should be equal to: toWei(1/1.1)
      (await invertedCryptoWatchPriceFeed.getHistoricalPrice(1588376340)).toString(),
      toBN(toWei("1"))
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("1.1")))
        .div(toBN("10").pow(toBN(18 - 10)))
        .toString()
    );

    // During period 2.
    assert.equal(
      // Should be equal to: toWei(1/1.2)
      (await invertedCryptoWatchPriceFeed.getHistoricalPrice(1588376405)).toString(),
      toBN(toWei("1"))
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("1.2")))
        .div(toBN("10").pow(toBN(18 - 10)))
        .toString()
    );

    // During period 3.
    assert.equal(
      // Should be equal to: toWei(1/1.3)
      (await invertedCryptoWatchPriceFeed.getHistoricalPrice(1588376515)).toString(),
      toBN(toWei("1"))
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("1.3")))
        .div(toBN("10").pow(toBN(18 - 10)))
        .toString()
    );

    // After period 3 should error.
    assert.isTrue(await invertedCryptoWatchPriceFeed.getHistoricalPrice(1588376521).catch(() => true));
  });

  it("No update", async function () {
    assert.equal(cryptoWatchPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await cryptoWatchPriceFeed.getHistoricalPrice(1000).catch(() => true));
    assert.equal(cryptoWatchPriceFeed.getLastUpdateTime(), undefined);
    assert.equal(cryptoWatchPriceFeed.getLookback(), 120);
  });

  it("Basic historical price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await cryptoWatchPriceFeed.update();

    // Before period 1 should fail.
    assert.isTrue(await cryptoWatchPriceFeed.getHistoricalPrice(1588376339).catch(() => true));

    // During period 1.
    assert.equal((await cryptoWatchPriceFeed.getHistoricalPrice(1588376340)).toString(), toWei("1.1"));

    // During period 2.
    assert.equal((await cryptoWatchPriceFeed.getHistoricalPrice(1588376405)).toString(), toWei("1.2"));

    // During period 3.
    assert.equal((await cryptoWatchPriceFeed.getHistoricalPrice(1588376515)).toString(), toWei("1.3"));

    // After period 3 should error.
    assert.isTrue(await cryptoWatchPriceFeed.getHistoricalPrice(1588376521).catch(() => true));
  });

  it("Missing historical data", async function () {
    // Missing middle data point
    networker.getJsonReturns = [
      {
        result: {
          60: [
            [1588376400, 1.1, 1.7, 0.5, 1.2, 281.73395575, 2705497.370853147],
            [1588376520, 1.3, 1.9, 0.7, 1.4, 888.92215493, 8601704.133826157],
          ],
        },
      },
      {
        result: {
          price: 1.5,
        },
      },
    ];

    await cryptoWatchPriceFeed.update();

    // During missing data point should fail.
    assert.isTrue(await cryptoWatchPriceFeed.getHistoricalPrice(1588376405).catch(() => true));

    // During last data point.
    assert.equal((await cryptoWatchPriceFeed.getHistoricalPrice(1588376515)).toString(), toWei("1.3"));
  });

  it("Basic TWAP price", async function () {
    cryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      18, // Add arbitrary decimal conversion and prove this works.
      undefined,
      120
    );

    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await cryptoWatchPriceFeed.update();

    // ((12 * 32) + (13 * 60) + (14 * 28)) / 120
    assert.equal(cryptoWatchPriceFeed.getCurrentPrice().toString(), "1296666666666666666");
  });

  it("Basic TWAP historical price", async function () {
    cryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      18, // Add arbitrary decimal conversion and prove this works.
      undefined,
      120
    );

    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await cryptoWatchPriceFeed.update();

    // ((12 * 60) + (11 * 60)) / 120
    assert.equal((await cryptoWatchPriceFeed.getHistoricalPrice(1588376460)).toString(), web3.utils.toWei("1.15"));
  });

  it("TWAP fails if period ends before data", async function () {
    cryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      18, // Add arbitrary decimal conversion and prove this works.
      undefined,
      500
    );

    // Inject data.
    networker.getJsonReturns = [...validResponses];
    const backupMockTime = mockTime;
    mockTime = 1588376339; // 1 second before first data point.

    await cryptoWatchPriceFeed.update();

    assert.isNull(cryptoWatchPriceFeed.getCurrentPrice());
    assert.isTrue(await cryptoWatchPriceFeed.getHistoricalPrice(mockTime).catch(() => true));
    mockTime = backupMockTime;
  });

  it("TWAP works with missing data at end", async function () {
    cryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      18, // Add arbitrary decimal conversion and prove this works.
      undefined,
      120
    );

    // Inject data.
    networker.getJsonReturns = JSON.parse(JSON.stringify(validResponses)); // deep copy
    networker.getJsonReturns[0].result["60"] = networker.getJsonReturns[0].result["60"].slice(0, -1);

    await cryptoWatchPriceFeed.update();

    // ((12 * 32) + (13 * 88)) / 120
    assert.equal(cryptoWatchPriceFeed.getCurrentPrice().toString(), "1273333333333333333");
  });

  it("TWAP works with missing data in the middle", async function () {
    cryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      18, // Add arbitrary decimal conversion and prove this works.
      undefined,
      120
    );

    // Inject data.
    networker.getJsonReturns = JSON.parse(JSON.stringify(validResponses)); // deep copy
    networker.getJsonReturns[0].result["60"].splice(1, 1);

    await cryptoWatchPriceFeed.update();

    // ((12 * 32) + (13 * 60) + (14 * 28)) / 120
    // Missing data is filled in by closePrices.
    assert.equal(cryptoWatchPriceFeed.getCurrentPrice().toString(), "1296666666666666666");
  });

  it("TWAP works with missing data at the beginning", async function () {
    cryptoWatchPriceFeed = new CryptoWatchPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      exchange,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      18, // Add arbitrary decimal conversion and prove this works.
      undefined,
      120
    );

    // Inject data.
    networker.getJsonReturns = JSON.parse(JSON.stringify(validResponses)); // deep copy
    networker.getJsonReturns[0].result["60"] = networker.getJsonReturns[0].result["60"].slice(2);

    await cryptoWatchPriceFeed.update();

    // ((13 * 60) + (14 * 28)) / 88
    assert.equal(cryptoWatchPriceFeed.getCurrentPrice().toString(), "1331818181818181818");
  });

  it("Basic current price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await cryptoWatchPriceFeed.update();

    // Should return the current price in the data.
    assert.equal(cryptoWatchPriceFeed.getCurrentPrice().toString(), toWei("1.5"));
  });

  it("Last update time", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await cryptoWatchPriceFeed.update();

    // Should return the mock time.
    assert.equal(cryptoWatchPriceFeed.getLastUpdateTime(), mockTime);
  });

  it("No or bad response", async function () {
    // Bad price response.
    networker.getJsonReturns = [
      {
        result: {
          60: [], // Valid response, just no data points.
        },
      },
      {
        result: {
          error: "test",
        },
      },
    ];

    // Update should throw errors in both cases.
    assert.isTrue(await cryptoWatchPriceFeed.update().catch(() => true), "Update didn't throw");
    assert.isTrue(await invertedCryptoWatchPriceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(cryptoWatchPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await cryptoWatchPriceFeed.getHistoricalPrice(1588376515).catch(() => true));
    assert.equal(invertedCryptoWatchPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await invertedCryptoWatchPriceFeed.getHistoricalPrice(1588376515).catch(() => true));

    // Bad historical ohlc response.
    networker.getJsonReturns = [
      {
        error: "test",
      },
      {
        result: {
          price: 15.1,
        },
      },
    ];

    assert.isTrue(await cryptoWatchPriceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(cryptoWatchPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await cryptoWatchPriceFeed.getHistoricalPrice(1588376515).catch(() => true));

    // Inverted price feed returns undefined for prices equal to 0 since it cannot divide by 0
    networker.getJsonReturns = [
      {
        error: "test",
      },
      {
        result: {
          price: 0,
        },
      },
    ];

    assert.isTrue(await invertedCryptoWatchPriceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(invertedCryptoWatchPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await invertedCryptoWatchPriceFeed.getHistoricalPrice(1588376515).catch(() => true));
  });

  it("Update frequency", async function () {
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

  it("apiKey present", async function () {
    networker.getJsonReturns = [...validResponses];
    await cryptoWatchPriceFeed.update();

    assert.deepStrictEqual(networker.getJsonInputs, [
      "https://api.cryptowat.ch/markets/test-exchange/test-pair/price?apikey=test-api-key",
      "https://api.cryptowat.ch/markets/test-exchange/test-pair/ohlc?before=1588376607&after=1588376460&periods=60&apikey=test-api-key",
    ]);
  });

  it("apiKey absent", async function () {
    cryptoWatchPriceFeed.apiKey = undefined;
    networker.getJsonReturns = [...validResponses];
    await cryptoWatchPriceFeed.update();

    assert.deepStrictEqual(networker.getJsonInputs, [
      "https://api.cryptowat.ch/markets/test-exchange/test-pair/price",
      "https://api.cryptowat.ch/markets/test-exchange/test-pair/ohlc?before=1588376607&after=1588376460&periods=60",
    ]);
  });
});
