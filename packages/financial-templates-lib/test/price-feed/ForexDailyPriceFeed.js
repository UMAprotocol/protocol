const { web3 } = require("hardhat");
const { assert } = require("chai");
const { ForexDailyPriceFeed } = require("../../dist/price-feed/ForexDailyPriceFeed");
const { NetworkerMock } = require("../../dist/price-feed/NetworkerMock");
const { spyLogIncludes, SpyTransport } = require("@uma/logger");
const winston = require("winston");
const moment = require("moment-timezone");
const { parseFixed } = require("@uma/common");
const sinon = require("sinon");

describe("ForexDailyPriceFeed.js", function () {
  let forexPriceFeed;
  // Keep test timezone consistent with price feed's. The API uses data published daily by the
  // ECB at 16:00 CET. Therefore, to convert from datestring to unix,
  // first convert to CET, and then add 16 hours, since the API "begins" days at 16:00.
  let mockTime = moment.tz("2021-03-12", "YYYY-MM-DD", "Europe/Berlin").endOf("day").add(16, "hours").unix();
  let networker;
  let spy;

  const base = "EUR";
  const symbol = "USD";
  const lookback = 0; // Lookback doesn't matter in this test since we populate the Networker
  const minTimeBetweenUpdates = 43200; // 12 hours.
  // with fake data.
  const getTime = () => mockTime;

  const { toBN } = web3.utils;
  const pricePrecision = 6;

  const convertPriceFeedDecimals = (number) => {
    return toBN(parseFixed(number.toString().substring(0, pricePrecision), pricePrecision).toString());
  };
  // Fake data to inject. Stress test with prices with lots of decimals
  // to ensure pricefeed correctly handles the edge case where API price # decimals > priceFeedDecimals
  const validResponses = [
    {
      rates: {
        "2021-03-09": { USD: 1.1933333333333333 },
        "2021-03-10": { USD: 1.1923333333333333 },
        "2021-03-11": { USD: 1.19263333333333333 },
        "2021-03-12": { USD: 1.19163333333333333 },
      },
      start_at: "2021-03-10",
      base: "EUR",
      end_at: "2021-03-12",
    },
  ];

  beforeEach(async function () {
    spy = sinon.spy();
    networker = new NetworkerMock();
    forexPriceFeed = new ForexDailyPriceFeed(
      winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
      web3,
      base,
      symbol,
      lookback,
      networker,
      getTime,
      pricePrecision // Add arbitrary decimal conversion.
    );
  });

  it("No update", async function () {
    assert.equal(forexPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await forexPriceFeed.getHistoricalPrice(1000).catch(() => true));
    assert.equal(forexPriceFeed.getLastUpdateTime(), undefined);
    assert.equal(forexPriceFeed.getLookback(), lookback);
  });

  it("Invalid base or symbol", async function () {
    let errorThrown = false;
    try {
      forexPriceFeed = new ForexDailyPriceFeed(
        winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
        web3,
        "invalid",
        symbol,
        lookback,
        networker,
        getTime,
        6 // Add arbitrary decimal conversion.
      );
    } catch (err) {
      errorThrown = true;
    }
    assert.isTrue(errorThrown);

    errorThrown = false;
    try {
      forexPriceFeed = new ForexDailyPriceFeed(
        winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
        web3,
        base,
        "invalid",
        lookback,
        networker,
        getTime,
        6 // Add arbitrary decimal conversion.
      );
    } catch (err) {
      errorThrown = true;
    }
    assert.isTrue(errorThrown);
  });

  it("Basic historical price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await forexPriceFeed.update();

    // Historical prices will be available from the oldest price's open time to the newest price's
    // close time.
    const validLookback =
      forexPriceFeed.historicalPricePeriods[forexPriceFeed.historicalPricePeriods.length - 1].closeTime -
      forexPriceFeed.historicalPricePeriods[0].openTime;

    // Before period 1 should fail.
    assert.isTrue(await forexPriceFeed.getHistoricalPrice(mockTime - validLookback - 1).catch(() => true));

    // During period 1.
    assert.equal(
      (await forexPriceFeed.getHistoricalPrice(mockTime - validLookback + 1)).toString(),
      convertPriceFeedDecimals("1.193333")
    );

    // During period 2.
    assert.equal(
      (await forexPriceFeed.getHistoricalPrice(mockTime - validLookback + 24 * 3600 + 1)).toString(),
      convertPriceFeedDecimals("1.192333")
    );

    // During period 3.
    assert.equal(
      (await forexPriceFeed.getHistoricalPrice(mockTime - validLookback + 2 * 24 * 3600 + 1)).toString(),
      convertPriceFeedDecimals("1.192633")
    );

    // After period 3 should return the most recent price.
    assert.equal(
      (await forexPriceFeed.getHistoricalPrice(mockTime + 1)).toString(),
      convertPriceFeedDecimals("1.191633")
    );
  });

  it("Basic current price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await forexPriceFeed.update();

    // Should return the current price in the data.
    assert.equal(forexPriceFeed.getCurrentPrice().toString(), convertPriceFeedDecimals("1.191633"));
  });

  it("Last update time", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await forexPriceFeed.update();

    // Should return the mock time.
    assert.equal(forexPriceFeed.getLastUpdateTime(), mockTime);
  });

  it("No or bad response", async function () {
    // Bad price response.
    networker.getJsonReturns = [
      {
        rates: {
          // Valid response, just missing some data points.
          "2021-03-09": {},
        },
      },
      { rates: {} },
      { error: "test" },
    ];

    // Update should throw errors in all cases.
    assert.isTrue(await forexPriceFeed.update().catch(() => true), "Update didn't throw");
    assert.isTrue(await forexPriceFeed.update().catch(() => true), "Update didn't throw");
    assert.isTrue(await forexPriceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(forexPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await forexPriceFeed.getHistoricalPrice(mockTime).catch(() => true));
  });

  it("Update frequency", async function () {
    networker.getJsonReturns = [...validResponses];

    await forexPriceFeed.update();

    networker.getJsonReturns = [...validResponses];

    // Advancing the pricefeed's time forward by anything less than `minTimeBetweenUpdates`
    // should make it skip an update.
    const originalMockTime = mockTime;
    mockTime += minTimeBetweenUpdates - 1;

    await forexPriceFeed.update();

    assert.isTrue(spyLogIncludes(spy, -1, "Update skipped because the last one was too recent"));
    assert.equal(forexPriceFeed.getLastUpdateTime(), originalMockTime);
  });
});
