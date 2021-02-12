const { TraderMadePriceFeed } = require("../../src/price-feed/TraderMadePriceFeed");
const { NetworkerMock } = require("../../src/price-feed/NetworkerMock");
const winston = require("winston");

contract("TraderMadePriceFeed.js", function() {
  let traderMadePriceFeed;
  let mockTime = 1614314000;
  let networker;

  const apiKey = "test-api-key";
  const pair = "test-pair";
  const minuteLookback = 600; // 10 minutes
  const hourlyLookback = 172800; // 2 days
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 600;

  const { toWei } = web3.utils;

  // Fake data to inject.
  // Note: the first element is the live pice, the second is the ohlc minute price, and the third is ohlc hourly price.
  const validResponses = [
    {
      quotes: [
        {
          ask: 0.1553
        }
      ]
    },
    {
      quotes: [
        {
          close: 0.1543,
          date: "2021-01-25 21:00:00"
        },
        {
          close: 0.1533,
          date: "2021-01-25 21:10:00"
        },
        {
          close: 0.1523,
          date: "2021-01-25 21:20:00"
        }
      ]
    },
    {
      quotes: [
        {
          close: 0.1543,
          date: "2021-01-25 21:00:00"
        },
        {
          close: 0.1533,
          date: "2021-01-25 22:00:00"
        },
        {
          close: 0.1523,
          date: "2021-01-25 23:00:00"
        }
      ]
    }
  ];

  beforeEach(async function() {
    networker = new NetworkerMock();
    const dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });
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
      18
    );
  });

  it("No update", async function() {
    assert.equal(traderMadePriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await traderMadePriceFeed.getHistoricalPrice(1000).catch(() => true));
    assert.equal(traderMadePriceFeed.getLastUpdateTime(), undefined);
  });

  it("Basic historical price", async function() {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await traderMadePriceFeed.update();

    // Before period 1 should fail.
    assert.isTrue(await traderMadePriceFeed.getHistoricalPrice(1611607700).catch(() => true));

    // During period 1.
    assert.equal((await traderMadePriceFeed.getHistoricalPrice(1611608300)).toString(), toWei("0.1543"));

    // During period 2.
    assert.equal((await traderMadePriceFeed.getHistoricalPrice(1611608900)).toString(), toWei("0.1533"));

    // During period 3.
    assert.equal((await traderMadePriceFeed.getHistoricalPrice(1611609500)).toString(), toWei("0.1523"));

    // After period 3 should return the most recent price.
    assert.equal((await traderMadePriceFeed.getHistoricalPrice(1611610100)).toString(), toWei("0.1553"));

    const expectOhlcHourlyPrices = [
      {
        closeTime: 1611608400,
        openTime: 1611604800
      },
      {
        closeTime: 1611612000,
        openTime: 1611608400
      },
      {
        closeTime: 1611615600,
        openTime: 1611612000
      }
    ];
    const actualOhlcHourlyPrices = traderMadePriceFeed.getHistoricalPricePeriods();
    for (let i = 0; i < expectOhlcHourlyPrices.length; i++) {
      assert.equal(expectOhlcHourlyPrices[i].closeTime, actualOhlcHourlyPrices[i].closeTime);
      assert.equal(expectOhlcHourlyPrices[i].openTime, actualOhlcHourlyPrices[i].openTime);
    }
  });

  it("Basic current price", async function() {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await traderMadePriceFeed.update();

    // Should return the current price in the data.
    assert.equal(traderMadePriceFeed.getCurrentPrice().toString(), toWei("0.1553"));
  });

  it("Last update time", async function() {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await traderMadePriceFeed.update();

    // Should return the mock time.
    assert.equal(traderMadePriceFeed.getLastUpdateTime(), mockTime);
  });

  it("No or bad response", async function() {
    // Bad price response.
    networker.getJsonReturns = [
      {
        quotes: [
          {
            error: "test"
          }
        ]
      },
      {
        quotes: [
          {
            close: 0.1543,
            date: "2021-01-26 00:00:00"
          },
          {
            close: 0.1533,
            date: "2021-01-26 00:00:00"
          },
          {
            close: 0.1523,
            date: "2021-01-26 00:00:00"
          }
        ]
      },
      {
        quotes: [
          {
            close: 0.1543,
            date: "2021-01-26 00:00:00"
          },
          {
            close: 0.1533,
            date: "2021-01-26 00:00:00"
          },
          {
            close: 0.1523,
            date: "2021-01-26 00:00:00"
          }
        ]
      }
    ];

    // Update should throw errors in both cases.
    assert.isTrue(await traderMadePriceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(traderMadePriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await traderMadePriceFeed.getHistoricalPrice(1614319100).catch(() => true));
    assert.equal(traderMadePriceFeed.getHistoricalPricePeriods(), undefined);

    // Bad historical ohlc response.
    networker.getJsonReturns = [
      {
        quotes: [
          {
            ask: 0.1553
          }
        ]
      },
      {
        quotes: [
          {
            error: "test"
          }
        ]
      },
      {
        quotes: [
          {
            error: "test"
          }
        ]
      }
    ];

    assert.isTrue(await traderMadePriceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(traderMadePriceFeed.getCurrentPrice().toString(), toWei("0.1553"));
    assert.isTrue(await traderMadePriceFeed.getHistoricalPrice(1614319100).catch(() => true));
    assert.equal(traderMadePriceFeed.getHistoricalPricePeriods(), undefined);
  });

  it("Update frequency", async function() {
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

  it("apiKey present", async function() {
    networker.getJsonReturns = [...validResponses];
    await traderMadePriceFeed.update();

    assert.deepStrictEqual(networker.getJsonInputs, [
      "https://marketdata.tradermade.com/api/v1/timeseries?currency=test-pair&api_key=test-api-key&start_date=2021-02-24-04:00&end_date=2021-02-26-04:43&format=records&interval=hourly",
      "https://marketdata.tradermade.com/api/v1/timeseries?currency=test-pair&api_key=test-api-key&start_date=2021-02-26-04:30&end_date=2021-02-26-04:43&format=records&interval=minute&period=10",
      "https://marketdata.tradermade.com/api/v1/live?currency=test-pair&api_key=test-api-key"
    ]);
  });

  it("apiKey absent", async function() {
    traderMadePriceFeed.apiKey = undefined;
    networker.getJsonReturns = [...validResponses];
    await traderMadePriceFeed.update();

    assert.deepStrictEqual(networker.getJsonInputs, [
      "https://marketdata.tradermade.com/api/v1/timeseries?currency=test-pair&api_key=undefined&start_date=2021-02-24-04:00&end_date=2021-02-26-04:43&format=records&interval=hourly",
      "https://marketdata.tradermade.com/api/v1/timeseries?currency=test-pair&api_key=undefined&start_date=2021-02-26-04:30&end_date=2021-02-26-04:43&format=records&interval=minute&period=10",
      "https://marketdata.tradermade.com/api/v1/live?currency=test-pair&api_key=undefined"
    ]);
  });
});
