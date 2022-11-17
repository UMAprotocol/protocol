const { web3 } = require("hardhat");
const { assert } = require("chai");
const { USPAC10GPriceFeed } = require("../../dist/price-feed/USPAC10GPriceFeed");
const { spyLogIncludes, SpyTransport } = require("../../dist/logger/SpyTransport");
const winston = require("winston");
const sinon = require("sinon");

class NetworkerMock {
  constructor(urlToResponse) {
    this.urlToResponse = { ...urlToResponse };
  }

  setResponse(url, resp) {
    this.urlToResponse[url] = resp;
  }

  getJson(url) {
    const resp = this.urlToResponse[url];
    if (resp == null) {
      throw new Error(`Unexpected request ${url}`);
    }
    return resp;
  }
}

describe("USPAC10GPriceFeed.js", function () {
  let feed;

  const rapidApiKey = "123";
  const lookback = 7200;
  const minTimeBetweenUpdates = 15 * 60; // 15min

  let mockTime = 100;
  const getTime = () => mockTime;

  let networker;
  let spy;

  const pricePrecision = 4;

  // Fake data to inject
  const urlToResponse = {
    // Historical price
    "https://spachero-spac-database.p.rapidapi.com/top10/": {
      Gainers: [
        {
          Commons_Symbol: "TINV",
          Commons_Daily_Change_Percent: "16.90",
          Commons_Price: "11.90",
          Commons_Volume: "934013",
        },
        {
          Commons_Symbol: "LAX",
          Commons_Daily_Change_Percent: "10.04",
          Commons_Price: "5.30",
          Commons_Volume: "59662",
        },
        {},
        {},
        {},
        {},
        {},
        {},
        {},
        {},
      ],
    },
    "https://mboum-finance.p.rapidapi.com/qu/quote?symbol=TINV,LAX": [
      {
        ask: 0,
        askSize: 30,
        averageDailyVolume10Day: 343710,
        averageDailyVolume3Month: 68793,
        bid: 0,
        bidSize: 8,
        bookValue: -0.336,
        currency: "USD",
        dividendDate: null,
        earningsTimestamp: null,
        earningsTimestampStart: null,
        earningsTimestampEnd: null,
        epsForward: null,
        epsTrailingTwelveMonths: -0.013,
        exchange: "NGM",
        exchangeDataDelayedBy: 0,
        exchangeTimezoneName: "America/New_York",
        exchangeTimezoneShortName: "EST",
        fiftyDayAverage: 9.6309,
        fiftyDayAverageChange: -4.3269005,
        fiftyDayAverageChangePercent: -0.4492727,
        fiftyTwoWeekHigh: 10.5,
        fiftyTwoWeekHighChange: -5.196,
        fiftyTwoWeekHighChangePercent: -0.49485716,
        fiftyTwoWeekLow: 4.13,
        fiftyTwoWeekLowChange: 1.1739998,
        fiftyTwoWeekLowChangePercent: 0.28426144,
        financialCurrency: "USD",
        forwardPE: null,
        fullExchangeName: "NasdaqGM",
        gmtOffSetMilliseconds: -18000000,
        language: "en-US",
        longName: "8i Acquisition 2 Corp.",
        market: "us_market",
        marketCap: 58733844,
        marketState: "PRE",
        messageBoardId: "finmb_716216409",
        postMarketChange: null,
        postMarketChangePercent: null,
        postMarketPrice: null,
        postMarketTime: null,
        priceHint: 2,
        priceToBook: -15.785714,
        quoteSourceName: "Nasdaq Real Time Price",
        quoteType: "EQUITY",
        regularMarketChange: 0.454,
        regularMarketChangePercent: 9.360825,
        regularMarketDayHigh: 5.46,
        regularMarketDayLow: 4.13,
        regularMarketOpen: 4.59,
        regularMarketPreviousClose: 4.85,
        regularMarketPrice: 5.304,
        regularMarketTime: { date: "2022-11-16 20:58:39.000000", timezone_type: 1, timezone: "+00:00" },
        regularMarketVolume: 59662,
        sharesOutstanding: 11073500,
        shortName: "8i Acquisition 2 Corp.",
        sourceInterval: 15,
        symbol: "LAX",
        tradeable: false,
        trailingAnnualDividendRate: 0,
        trailingAnnualDividendYield: 0,
        trailingPE: null,
        twoHundredDayAverage: 9.80461,
        twoHundredDayAverageChange: -4.5006104,
        twoHundredDayAverageChangePercent: -0.45903,
      },
    ],
    "https://mboum-finance.p.rapidapi.com/hi/history?symbol=LAX&interval=1d&diffandsplits=false": {
      meta: {
        currency: "USD",
        symbol: "LAX",
        exchangeName: "NGM",
        instrumentType: "EQUITY",
        firstTradeDate: 1639492200,
        regularMarketTime: 1668632319,
        gmtoffset: -18000,
        timezone: "EST",
        exchangeTimezoneName: "America/New_York",
        regularMarketPrice: 5.304,
        chartPreviousClose: 9.65,
        priceHint: 2,
        dataGranularity: "1d",
        range: "",
      },
      items: {
        1668436200: {
          date: "11-14-2022",
          date_utc: 1668436200,
          open: 6.49,
          high: 6.49,
          low: 4.7,
          close: 5.47,
          volume: 2117500,
          adjclose: 5.47,
        },
        1668522600: {
          date: "11-15-2022",
          date_utc: 1668522600,
          open: 5.31,
          high: 5.5,
          low: 4.7,
          close: 4.82,
          volume: 14700,
          adjclose: 4.82,
        },
        1668609000: {
          date: "11-16-2022",
          date_utc: 1668609000,
          open: 4.59,
          high: 5.5,
          low: 4.07,
          close: 5.3,
          volume: 59700,
          adjclose: 5.3,
        },
      },
      error: null,
    },
    "https://mboum-finance.p.rapidapi.com/hi/history?symbol=TINV&interval=1d&diffandsplits=false": {
      meta: {
        currency: "USD",
        symbol: "TINV",
        exchangeName: "NYQ",
        instrumentType: "EQUITY",
        firstTradeDate: 1610634600,
        regularMarketTime: 1668632401,
        gmtoffset: -18000,
        timezone: "EST",
        exchangeTimezoneName: "America/New_York",
        regularMarketPrice: 11.9,
        chartPreviousClose: 10.67,
        priceHint: 2,
        dataGranularity: "1d",
        range: "",
      },
      items: {
        1668436200: {
          date: "11-14-2022",
          date_utc: 1668436200,
          open: 10.65,
          high: 10.89,
          low: 10.44,
          close: 10.64,
          volume: 49200,
          adjclose: 10.64,
        },
        1668522600: {
          date: "11-15-2022",
          date_utc: 1668522600,
          open: 10.52,
          high: 10.52,
          low: 10.02,
          close: 10.18,
          volume: 14200,
          adjclose: 10.18,
        },
        1668609000: {
          date: "11-16-2022",
          date_utc: 1668609000,
          open: 10.41,
          high: 15.63,
          low: 8.23,
          close: 11.9,
          volume: 933900,
          adjclose: 11.9,
        },
      },
      error: null,
    },
  };

  beforeEach(async function () {
    spy = sinon.spy();
    networker = new NetworkerMock(urlToResponse);
    feed = new USPAC10GPriceFeed(
      winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
      web3,
      rapidApiKey,
      "1d",
      lookback,
      networker,
      getTime,
      pricePrecision,
      minTimeBetweenUpdates,
      2
    );
  });

  it("No update", async function () {
    assert.equal(feed.getCurrentPrice(), undefined);
    assert.equal(feed.getLastUpdateTime(), undefined);
    assert.equal(feed.getLookback(), lookback);
  });

  it("Basic current price", async function () {
    await feed.update();

    assert.equal(feed.getCurrentPrice().toString(), "86020" /* (5.304 + 11.9) / 2 = 8.602 */);
  });

  it("getHistoricalPrice", async function () {
    await feed.update();

    // No data, timestamp past last data point
    assert.isTrue(await feed.getHistoricalPrice(0).catch(() => true), "getHistoricalPrice didn't throw");
    assert.equal((await feed.getHistoricalPrice(1668522600)).toString(), "75000" /* (4.83 + 10.18) / 2 = 7.5 */);
    assert.equal((await feed.getHistoricalPrice(1668609000)).toString(), "86000" /* (5.3 + 11.9) / 2 = 8.6 */);
  });

  it("Last update time", async function () {
    await feed.update();

    // Should return the mock time.
    assert.equal(feed.getLastUpdateTime(), mockTime);
  });

  it("No or bad API response", async function () {
    networker.setResponse("https://spachero-spac-database.p.rapidapi.com/top10/", "error");
    assert.isTrue(await feed.update().catch(() => true), "Update didn't throw");
    assert.equal(feed.getCurrentPrice(), undefined);
  });

  it("Update frequency", async function () {
    await feed.update();

    // Advancing the pricefeed's time forward by anything less than `minTimeBetweenUpdates`
    // should make it skip an update.
    const originalMockTime = mockTime;
    mockTime += minTimeBetweenUpdates - 1;

    await feed.update();

    assert.isTrue(spyLogIncludes(spy, -1, "Update skipped because the last one was too recent"));
    assert.equal(feed.getLastUpdateTime(), originalMockTime);
  });
});
