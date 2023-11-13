const { web3 } = require("hardhat");
const { assert } = require("chai");
const { TraderMadePriceFeed } = require("../../dist/price-feed/TraderMadePriceFeed");
const { NetworkerMock } = require("../../dist/price-feed/NetworkerMock");
const { spyLogIncludes, SpyTransport } = require("@uma/logger");
const winston = require("winston");
const sinon = require("sinon");
const moment = require("moment");

describe("TraderMadePriceFeed.js", function () {
  let traderMadePriceFeed;
  let mockTime = 1614314000;
  let networker;
  let spy;

  const apiKey = "test-api-key";
  const pair = "test-pair";
  const minuteLookback = 600; // 10 minutes
  const ohlcPeriod = 10;
  const hourlyLookback = 172800; // 2 days
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 600;

  // TraderMadePriceFeed converts "date" strings (YYYY-MM-DD HH:mm:ss) into unix timestamps,
  // therefore to test that timestamps are set/fetched correctly we need to adjust for how `moment`
  // will convert date-strings into UNIX time for the local machine.
  // For example: `moment().utcOffset()` will return -300 if you are in GMT-5, so we
  // can use this value to make sure tests pass on all machines regardless of zone.
  const timezoneOffsetMinutes = moment().utcOffset();
  const timezeoneOffsetSeconds = timezoneOffsetMinutes * 60;

  const { toWei } = web3.utils;

  // Fake data to inject.
  // Note: the first element is the live pice, the second is the ohlc minute price, and the third is ohlc hourly price.
  const validResponses = [
    { quotes: [{ ask: 0.1553 }] },
    {
      quotes: [
        { close: 0.1543, date: "2021-01-25 21:00:00" },
        { close: 0.1533, date: "2021-01-25 21:10:00" },
        { close: 0.1523, date: "2021-01-25 21:20:00" },
      ],
    },
    {
      quotes: [
        { close: 0.1543, date: "2021-01-25 21:00:00" },
        { close: 0.1533, date: "2021-01-25 22:00:00" },
        { close: 0.1523, date: "2021-01-25 23:00:00" },
      ],
    },
  ];

  beforeEach(async function () {
    networker = new NetworkerMock();
    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
    traderMadePriceFeed = new TraderMadePriceFeed(
      dummyLogger,
      web3,
      apiKey,
      pair,
      minuteLookback,
      hourlyLookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      18,
      ohlcPeriod
    );
  });

  it("No update", async function () {
    assert.equal(traderMadePriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await traderMadePriceFeed.getHistoricalPrice(1000).catch(() => true));
    assert.equal(traderMadePriceFeed.getLastUpdateTime(), undefined);
  });

  it("Basic historical price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await traderMadePriceFeed.update();

    // Before period 1 should fail.
    assert.isTrue(await traderMadePriceFeed.getHistoricalPrice(1611607700 - timezeoneOffsetSeconds).catch(() => true));

    // During period 1.
    assert.equal(
      (await traderMadePriceFeed.getHistoricalPrice(1611608300 - timezeoneOffsetSeconds)).toString(),
      toWei("0.1543")
    );

    // During period 2.
    assert.equal(
      (await traderMadePriceFeed.getHistoricalPrice(1611608900 - timezeoneOffsetSeconds)).toString(),
      toWei("0.1533")
    );

    // During period 3.
    assert.equal(
      (await traderMadePriceFeed.getHistoricalPrice(1611609500 - timezeoneOffsetSeconds)).toString(),
      toWei("0.1523")
    );

    // After period 3 should return the most recent price.
    assert.equal(
      (await traderMadePriceFeed.getHistoricalPrice(1611610100 - timezeoneOffsetSeconds)).toString(),
      toWei("0.1553")
    );

    const expectOhlcHourlyPrices = [
      { closeTime: 1611608400, openTime: 1611604800 },
      { closeTime: 1611612000, openTime: 1611608400 },
      { closeTime: 1611615600, openTime: 1611612000 },
    ];
    const actualOhlcHourlyPrices = traderMadePriceFeed.getHistoricalPricePeriods();
    for (let i = 0; i < expectOhlcHourlyPrices.length; i++) {
      assert.equal(expectOhlcHourlyPrices[i].closeTime - timezeoneOffsetSeconds, actualOhlcHourlyPrices[i].closeTime);
      assert.equal(expectOhlcHourlyPrices[i].openTime - timezeoneOffsetSeconds, actualOhlcHourlyPrices[i].openTime);
    }
  });

  it("Basic current price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await traderMadePriceFeed.update();

    // Should return the current price in the data.
    assert.equal(traderMadePriceFeed.getCurrentPrice().toString(), toWei("0.1553"));
  });

  it("Last update time", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await traderMadePriceFeed.update();

    // Should return the mock time.
    assert.equal(traderMadePriceFeed.getLastUpdateTime(), mockTime);
  });

  describe("Hourly interval can act as historical price fallback for minute interval", function () {
    it("Fallback to hourly interval ENABLED, failure to fetch minute interval successfully fetches hourly data", async function () {
      // Missing minute interval historical ohlc response. Fallback to hourly interval succeeds,
      // so historical price is available.
      networker.getJsonReturns = [
        { quotes: [{ ask: 0.1553 }] },
        { quotes: [{ error: "test" }] },
        {
          quotes: [
            { close: 0.1543, date: "2021-01-25 21:00:00" },
            { close: 0.1533, date: "2021-01-25 22:00:00" },
            { close: 0.1523, date: "2021-01-25 23:00:00" },
          ],
        },
      ];

      // Create spy to listen for debug level events to catch fallback log.
      spy = sinon.spy();
      traderMadePriceFeed = new TraderMadePriceFeed(
        winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
        web3,
        apiKey,
        pair,
        minuteLookback,
        hourlyLookback,
        networker,
        getTime,
        minTimeBetweenUpdates,
        18
      );
      // Update should not throw and the historical price should correspond to hourly interval data.
      await traderMadePriceFeed.update();

      // Second to last log should be about falling back to hourly interval:
      assert.isTrue(spyLogIncludes(spy, -2, "updateMinute failed, falling back to updateHourly"));

      assert.equal(traderMadePriceFeed.getCurrentPrice().toString(), toWei("0.1553"));
      assert.equal(
        (await traderMadePriceFeed.getHistoricalPrice(1611608300 - timezeoneOffsetSeconds)).toString(),
        toWei("0.1543")
      );
      assert.equal(traderMadePriceFeed.getHistoricalPricePeriods().length, 3);
    });
    it("Fallback to hourly interval DISABLED, failure to fetch minute interval fails", async function () {
      // Missing minute interval historical ohlc response.
      networker.getJsonReturns = [
        { quotes: [{ ask: 0.1553 }] },
        { quotes: [{ error: "test" }] },
        {
          quotes: [
            { close: 0.1543, date: "2021-01-25 21:00:00" },
            { close: 0.1533, date: "2021-01-25 22:00:00" },
            { close: 0.1523, date: "2021-01-25 23:00:00" },
          ],
        },
      ];

      // Create spy to make sure no "fallback" logs are emitted
      spy = sinon.spy();
      traderMadePriceFeed = new TraderMadePriceFeed(
        winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
        web3,
        apiKey,
        pair,
        minuteLookback,
        0, // hourly lookback disabled!
        networker,
        getTime,
        minTimeBetweenUpdates,
        18
      );

      // Update should throw since no hourly fallback is specified and there is no minute data.
      assert.isTrue(await traderMadePriceFeed.update().catch(() => true), "Update didn't throw");
      // Last log should be about updating minute interval.
      assert.isTrue(spyLogIncludes(spy, -1, "Updating Minute Price"));

      assert.equal(traderMadePriceFeed.getCurrentPrice().toString(), toWei("0.1553"));
      assert.isTrue(
        await traderMadePriceFeed.getHistoricalPrice(1611608300 - timezeoneOffsetSeconds).catch(() => true)
      );
      assert.equal(traderMadePriceFeed.getHistoricalPricePeriods().length, 0);
    });
    it("Fallback to hourly interval ENABLED, latest, minute and hourly intervals all fail to respond", async function () {
      // Bad current price response causes update() to throw regardless of historical data.
      networker.getJsonReturns = [
        { quotes: [{ error: "test" }] },
        {
          quotes: [
            { close: 0.1543, date: "2021-01-26 00:00:00" },
            { close: 0.1533, date: "2021-01-26 00:00:00" },
            { close: 0.1523, date: "2021-01-26 00:00:00" },
          ],
        },
        {
          quotes: [
            { close: 0.1543, date: "2021-01-26 00:00:00" },
            { close: 0.1533, date: "2021-01-26 00:00:00" },
            { close: 0.1523, date: "2021-01-26 00:00:00" },
          ],
        },
      ];

      // Update should throw errors in both cases because the `updateLatest` method throws.
      assert.isTrue(await traderMadePriceFeed.update().catch(() => true), "Update didn't throw");

      assert.equal(traderMadePriceFeed.getCurrentPrice(), null);
      assert.isTrue(
        await traderMadePriceFeed.getHistoricalPrice(1614319100 - timezeoneOffsetSeconds).catch(() => true)
      );
      assert.equal(traderMadePriceFeed.getHistoricalPricePeriods().length, 0);

      // Missing minute and hourly interval historical ohlc response. Minute interval and subsequent
      // fallback to hourly interval fail.
      networker.getJsonReturns = [
        { quotes: [{ ask: 0.1553 }] },
        { quotes: [{ error: "test" }] },
        { quotes: [{ error: "test" }] },
      ];

      // Create spy to listen for fallback failure
      spy = sinon.spy();
      traderMadePriceFeed = new TraderMadePriceFeed(
        winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
        web3,
        apiKey,
        pair,
        minuteLookback,
        hourlyLookback,
        networker,
        getTime,
        minTimeBetweenUpdates,
        18
      );

      assert.isTrue(await traderMadePriceFeed.update().catch(() => true), "Update didn't throw");
      // Last log should be fallback to hourly failing.
      assert.isTrue(spyLogIncludes(spy, -1, "fallback to updateHourly also failed"));

      assert.equal(traderMadePriceFeed.getCurrentPrice().toString(), toWei("0.1553"));
      assert.isTrue(
        await traderMadePriceFeed.getHistoricalPrice(1614319100 - timezeoneOffsetSeconds).catch(() => true)
      );
      assert.equal(traderMadePriceFeed.getHistoricalPricePeriods().length, 0);
    });
    it("minuteLookback is undefined, only need to fetch hourly interval data", async function () {
      // Missing minute interval historical ohlc response is not a problem if minuteLookback is not set.
      networker.getJsonReturns = [
        { quotes: [{ ask: 0.1553 }] },
        { quotes: [{ error: "test" }] },
        {
          quotes: [
            { close: 0.1543, date: "2021-01-25 21:00:00" },
            { close: 0.1533, date: "2021-01-25 22:00:00" },
            { close: 0.1523, date: "2021-01-25 23:00:00" },
          ],
        },
      ];
      traderMadePriceFeed = new TraderMadePriceFeed(
        winston.createLogger({ level: "info", transports: [new winston.transports.Console()] }),
        web3,
        apiKey,
        pair,
        0, // minute lookback disabled!
        hourlyLookback,
        networker,
        getTime,
        minTimeBetweenUpdates,
        18
      );

      // Update should not throw and the historical price should correspond to hourly interval data.
      assert.isTrue(await traderMadePriceFeed.update().catch(() => true), "Update didn't throw");

      assert.equal(traderMadePriceFeed.getCurrentPrice().toString(), toWei("0.1553"));
      assert.isTrue(
        await traderMadePriceFeed.getHistoricalPrice(1611608300 - timezeoneOffsetSeconds).catch(() => true)
      );
      assert.equal(traderMadePriceFeed.getHistoricalPricePeriods().length, 0);
    });
  });

  it("Update frequency", async function () {
    networker.getJsonReturns = [...validResponses];

    await traderMadePriceFeed.update();

    networker.getJsonReturns = [...validResponses];

    // Update the return price to ensure it new data doesn't show up in the output.
    networker.getJsonReturns[0].quotes[0].ask = 1.4;

    const originalMockTime = mockTime;
    mockTime += minTimeBetweenUpdates - 1;

    await traderMadePriceFeed.update();
    assert.equal(traderMadePriceFeed.getLastUpdateTime(), originalMockTime);
    assert.equal(traderMadePriceFeed.getCurrentPrice().toString(), toWei("0.1553"));
  });

  it("apiKey present", async function () {
    networker.getJsonReturns = [...validResponses];
    await traderMadePriceFeed.update();

    // TODO: The `start_date` and `end_date` need to be adjusted for machine timezone.
    assert.deepStrictEqual(networker.getJsonInputs, [
      "https://marketdata.tradermade.com/api/v1/timeseries?currency=test-pair&api_key=test-api-key&start_date=2021-02-24-04:00&end_date=2021-02-26-04:43&format=records&interval=hourly",
      "https://marketdata.tradermade.com/api/v1/timeseries?currency=test-pair&api_key=test-api-key&start_date=2021-02-26-04:30&end_date=2021-02-26-04:43&format=records&interval=minute&period=10",
      "https://marketdata.tradermade.com/api/v1/live?currency=test-pair&api_key=test-api-key",
    ]);
  });

  it("apiKey absent", async function () {
    traderMadePriceFeed.apiKey = undefined;
    networker.getJsonReturns = [...validResponses];
    await traderMadePriceFeed.update();

    // TODO: The `start_date` and `end_date` need to be adjusted for machine timezone.
    assert.deepStrictEqual(networker.getJsonInputs, [
      "https://marketdata.tradermade.com/api/v1/timeseries?currency=test-pair&api_key=undefined&start_date=2021-02-24-04:00&end_date=2021-02-26-04:43&format=records&interval=hourly",
      "https://marketdata.tradermade.com/api/v1/timeseries?currency=test-pair&api_key=undefined&start_date=2021-02-26-04:30&end_date=2021-02-26-04:43&format=records&interval=minute&period=10",
      "https://marketdata.tradermade.com/api/v1/live?currency=test-pair&api_key=undefined",
    ]);
  });
});
