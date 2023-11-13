const { web3 } = require("hardhat");
const { assert } = require("chai");
const { QuandlPriceFeed } = require("../../dist/price-feed/QuandlPriceFeed");
const { NetworkerMock } = require("../../dist/price-feed/NetworkerMock");
const { spyLogIncludes, SpyTransport } = require("@uma/logger");
const winston = require("winston");
const moment = require("moment");
const { parseFixed } = require("@uma/common");
const sinon = require("sinon");

describe("QuandlPriceFeed.js", function () {
  let quandlPriceFeed;
  // Keep test timezone consistent with price feed's. Set mock time equal to
  // close of the most recent day.
  let mockTime = moment("2021-03-12", "YYYY-MM-DD").endOf("day").unix();
  let networker;
  let spy;

  const apiKey = "123";
  const datasetCode = "CHRIS";
  const databaseCode = "CME_MGC1";
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
      dataset_data: {
        column_names: [
          "Date",
          "Open",
          "High",
          "Low",
          "Last",
          "Change",
          "Settle",
          "Volume",
          "Previous Day Open Interest",
        ],
        start_date: "2021-03-09",
        end_date: "2021-03-12",
        frequency: "daily",
        data: [
          ["2021-03-12", 1720.12222222222, 1727.9, 1696.6, 1725.2222222222, -2.8, 1719.8, 64823.0, 21102.0],
          ["2021-03-11", 1725.02222222222, 1738.0, 1716.7, 1720.9222222222, 0.8, 1722.6, 51362.0, 20996.0],
          ["2021-03-10", 1714.62222222222, 1725.4, 1705.8, 1725.2222222222, 4.9, 1721.8, 45206.0, 20960.0],
          ["2021-03-09", 1679.52222222222, 1718.8, 1676.8, 1714.1222222222, 38.9, 1716.9, 56794.0, 22221.0],
        ],
        collapse: "daily",
      },
    },
  ];

  beforeEach(async function () {
    spy = sinon.spy();
    networker = new NetworkerMock();
    quandlPriceFeed = new QuandlPriceFeed(
      winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
      web3,
      apiKey,
      datasetCode,
      databaseCode,
      lookback,
      networker,
      getTime,
      pricePrecision // Add arbitrary decimal conversion.
    );
  });

  it("No update", async function () {
    assert.equal(quandlPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await quandlPriceFeed.getHistoricalPrice(1000).catch(() => true));
    assert.equal(quandlPriceFeed.getLastUpdateTime(), undefined);
    assert.equal(quandlPriceFeed.getLookback(), lookback);
  });

  it("Basic historical price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await quandlPriceFeed.update();

    // Historical prices will be available from the oldest price's open time to the newest price's
    // close time.
    const validLookback =
      quandlPriceFeed.historicalPricePeriods[quandlPriceFeed.historicalPricePeriods.length - 1].closeTime -
      quandlPriceFeed.historicalPricePeriods[0].openTime;

    // Before period 1 should fail.
    assert.isTrue(await quandlPriceFeed.getHistoricalPrice(mockTime - validLookback - 1).catch(() => true));

    // Prices should always be the open price, unless the timestamp is beyond the last period,
    // in which it uses the most recent close price.

    // During period 1.
    assert.equal(
      (await quandlPriceFeed.getHistoricalPrice(mockTime - validLookback + 1)).toString(),
      convertPriceFeedDecimals("1679.522222")
    );

    // During period 2.
    assert.equal(
      (await quandlPriceFeed.getHistoricalPrice(mockTime - validLookback + 24 * 3600 + 1)).toString(),
      convertPriceFeedDecimals("1714.622222")
    );

    // During period 3.
    assert.equal(
      (await quandlPriceFeed.getHistoricalPrice(mockTime - validLookback + 2 * 24 * 3600 + 1)).toString(),
      convertPriceFeedDecimals("1725.022222")
    );

    // After period 3 should return the most recent (close) price.
    assert.equal(
      (await quandlPriceFeed.getHistoricalPrice(mockTime + 1)).toString(),
      convertPriceFeedDecimals("1725.222222")
    );
  });

  it("Basic current price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await quandlPriceFeed.update();

    // Should return the most recent, close price in the data.
    assert.equal(quandlPriceFeed.getCurrentPrice().toString(), convertPriceFeedDecimals("1725.222222"));
  });

  it("Last update time", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await quandlPriceFeed.update();

    // Should return the mock time.
    assert.equal(quandlPriceFeed.getLastUpdateTime(), mockTime);
  });

  it("No or bad response", async function () {
    // Bad price response.
    networker.getJsonReturns = [
      {
        dataset_data: {
          data: [
            // Some missing daily data
            [],
            ["2021-03-12", 1720.12222222222, 1727.9, 1696.6, 1725.2222222222, -2.8, 1719.8, 64823.0, 21102.0],
          ],
        },
      },
      {
        dataset_data: {
          // Empty data array
          data: [],
        },
      },
      {
        dataset_data: {
          // Missing data array
        },
      },
      { error: "test" },
    ];

    // Update should throw errors in all cases.
    assert.isTrue(await quandlPriceFeed.update().catch(() => true), "Update didn't throw");
    assert.isTrue(await quandlPriceFeed.update().catch(() => true), "Update didn't throw");
    assert.isTrue(await quandlPriceFeed.update().catch(() => true), "Update didn't throw");
    assert.isTrue(await quandlPriceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(quandlPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await quandlPriceFeed.getHistoricalPrice(mockTime).catch(() => true));
  });

  it("Update frequency", async function () {
    networker.getJsonReturns = [...validResponses];

    await quandlPriceFeed.update();

    networker.getJsonReturns = [...validResponses];

    // Advancing the pricefeed's time forward by anything less than `minTimeBetweenUpdates`
    // should make it skip an update.
    const originalMockTime = mockTime;
    mockTime += minTimeBetweenUpdates - 1;

    await quandlPriceFeed.update();

    assert.isTrue(spyLogIncludes(spy, -1, "Update skipped because the last one was too recent"));
    assert.equal(quandlPriceFeed.getLastUpdateTime(), originalMockTime);
  });
});
