const { web3 } = require("hardhat");
const { assert } = require("chai");
const { USPACPriceFeed } = require("../../dist/price-feed/USPACPriceFeed");
const { spyLogIncludes, SpyTransport } = require("@uma/logger");
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

describe("USPACPriceFeed.js", function () {
  let feed;

  const rapidApiKey = "123";
  const lookback = 7200;
  const minTimeBetweenUpdates = 15 * 60; // 15min

  let mockTime = 100;
  const getTime = () => mockTime;

  let networker;
  let spy;

  const pricePrecision = 4;

  const MOMENT1 = 1 + 0 * 60;
  const MOMENT2 = 1 + 1 * 60;

  // Fake data to inject
  const urlToResponse = {
    // Historical price
    "https://stock-data-yahoo-finance-alternative.p.rapidapi.com/v8/finance/spark?symbols=PSTH%2CIPOF&range=1d&interval=1m": {
      PSTH: { symbol: "PSTH", timestamp: [MOMENT1, MOMENT2], close: [10, 100.0] },
      IPOF: { symbol: "IPOF", timestamp: [MOMENT1, MOMENT2], close: [10, 300.0] },
    },
    // Current price
    "https://stock-data-yahoo-finance-alternative.p.rapidapi.com/v6/finance/quote?symbols=PSTH%2CIPOF": {
      quoteResponse: {
        result: [
          { regularMarketPrice: 100.01, symbol: "PSTH" },
          { regularMarketPrice: 200.0, symbol: "IPOF" },
        ],
      },
    },
  };

  beforeEach(async function () {
    spy = sinon.spy();
    networker = new NetworkerMock(urlToResponse);
    feed = new USPACPriceFeed(
      winston.createLogger({ level: "info", transports: [new SpyTransport({ level: "debug" }, { spy: spy })] }),
      web3,
      ["PSTH", "IPOF"],
      "0.9" /* correctionFactor */,
      rapidApiKey,
      undefined,
      lookback,
      networker,
      getTime,
      pricePrecision, // Add arbitrary decimal conversion.
      minTimeBetweenUpdates
    );
  });

  it("No update", async function () {
    assert.equal(feed.getCurrentPrice(), undefined);
    assert.equal(feed.getLastUpdateTime(), undefined);
    assert.equal(feed.getLookback(), lookback);
  });

  it("Basic current price", async function () {
    await feed.update();

    // Should return the most recent, close price in the data.
    assert.equal(feed.getCurrentPrice().toString(), "1350045" /* ((100.01 + 200) / 2) * 0.9 */);
  });

  it("getHistoricalPrice", async function () {
    await feed.update();

    // No data, timestamp past last data point
    assert.isTrue(await feed.getHistoricalPrice(0).catch(() => true), "getHistoricalPrice didn't throw");

    assert.equal((await feed.getHistoricalPrice(MOMENT1)).toString(), "90000" /* ((10.00 +  10.00) / 2) * 0.9 */);
    assert.equal((await feed.getHistoricalPrice(MOMENT1 + 1)).toString(), "90000" /* ((10.00 +  10.00) / 2) * 0.9 */);

    assert.equal((await feed.getHistoricalPrice(MOMENT2)).toString(), "1800000" /* ((100.00 +  300.00) / 2) * 0.9 */);
    assert.equal(
      (await feed.getHistoricalPrice(MOMENT2 + 1)).toString(),
      "1800000" /* ((100.00 +  300.00) / 2) * 0.9 */
    );
  });

  it("Last update time", async function () {
    await feed.update();

    // Should return the mock time.
    assert.equal(feed.getLastUpdateTime(), mockTime);
  });

  it("No or bad API response", async function () {
    networker.setResponse(
      "https://stock-data-yahoo-finance-alternative.p.rapidapi.com/v6/finance/quote?symbols=PSTH%2CIPOF",
      "error"
    );
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
