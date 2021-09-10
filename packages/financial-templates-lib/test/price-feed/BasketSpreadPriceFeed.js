const { assert } = require("chai");
const { web3 } = require("hardhat");
const winston = require("winston");

const { toWei, toBN } = web3.utils;

const { MedianizerPriceFeed } = require("../../dist/price-feed/MedianizerPriceFeed");
const { BasketSpreadPriceFeed } = require("../../dist/price-feed/BasketSpreadPriceFeed");
const { PriceFeedMock } = require("../../dist/price-feed/PriceFeedMock");

describe("BasketSpreadPriceFeed.js", function () {
  let baselinePriceFeeds;
  let experimentalPriceFeeds;
  let denominatorPriceFeed;
  let dummyLogger;
  let basketSpreadPriceFeed;

  beforeEach(async function () {
    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
  });
  it("Update", async function () {
    const priceFeeds = [new PriceFeedMock()];
    baselinePriceFeeds = [new MedianizerPriceFeed(priceFeeds), new MedianizerPriceFeed(priceFeeds)];
    experimentalPriceFeeds = [new MedianizerPriceFeed(priceFeeds), new MedianizerPriceFeed(priceFeeds)];
    denominatorPriceFeed = new MedianizerPriceFeed(priceFeeds);

    basketSpreadPriceFeed = new BasketSpreadPriceFeed(
      web3,
      dummyLogger,
      baselinePriceFeeds,
      experimentalPriceFeeds,
      denominatorPriceFeed
    );

    await basketSpreadPriceFeed.update();

    // On the basket spread's update call, `priceFeeds[0]` should have been updated once for each
    // Medianizer price feed that it is incorporated in. This is because the basket spread price feed
    // updates its imported medianizer price feeds.
    // Check work: 2x for baseline update, 2x experimental udpate, 1x for denominator = 5 total.
    assert.equal(priceFeeds[0].updateCalled, 5);
  });
  describe("Computing basket spreads when the spread is within the range [0,2]", function () {
    function _constructPriceFeedsWithPrecision(precision, noDenominator = false) {
      // First let's construct the constituent pricefeeds of the baskets.
      const baselineFeeds1 = new MedianizerPriceFeed(
        [
          //                currentPrice      historicalPrice    lastUpdatedTime
          new PriceFeedMock(
            toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.2")).div(toBN(10).pow(toBN(18 - precision))),
            200,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("1.5")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("1.3")).div(toBN(10).pow(toBN(18 - precision))),
            55000,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("9")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("2")).div(toBN(10).pow(toBN(18 - precision))),
            50,
            precision
          ),
        ],
        false
      );
      // Computes the median:
      // current: 1.5
      // historical: 1.3
      const baselineFeeds2 = new MedianizerPriceFeed(
        [
          //                currentPrice      historicalPrice    lastUpdatedTime
          new PriceFeedMock(
            toBN(toWei("1.1")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.6")).div(toBN(10).pow(toBN(18 - precision))),
            200,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("2")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.8")).div(toBN(10).pow(toBN(18 - precision))),
            55000,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("2.3")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("2.2")).div(toBN(10).pow(toBN(18 - precision))),
            50,
            precision
          ),
        ],
        true
      );
      // Computes the mean:
      // current: 1.8
      // historical: 1.2

      baselinePriceFeeds = [baselineFeeds1, baselineFeeds2];
      // Average basket price:
      // current: 1.65
      // historical: 1.25

      const experimentalFeeds1 = new MedianizerPriceFeed(
        [
          //                currentPrice      historicalPrice    lastUpdatedTime
          new PriceFeedMock(
            toBN(toWei("1.1")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.6")).div(toBN(10).pow(toBN(18 - precision))),
            400,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("1.2")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("2")).div(toBN(10).pow(toBN(18 - precision))),
            60000,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("1.3")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("66")).div(toBN(10).pow(toBN(18 - precision))),
            100,
            precision
          ),
        ],
        false
      );
      // Computes the median:
      // current: 1.2
      // historical: 2
      const experimentalFeeds2 = new MedianizerPriceFeed(
        [
          //                currentPrice      historicalPrice    lastUpdatedTime
          new PriceFeedMock(
            toBN(toWei("0.9")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.25")).div(toBN(10).pow(toBN(18 - precision))),
            800,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("1.3")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.75")).div(toBN(10).pow(toBN(18 - precision))),
            650000,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("2")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("2")).div(toBN(10).pow(toBN(18 - precision))),
            200,
            precision
          ),
        ],
        true
      );
      // Computes the mean:
      // current: 1.4
      // historical: 1

      experimentalPriceFeeds = [experimentalFeeds1, experimentalFeeds2];
      // Average basket price:
      // current: 1.3
      // historical: 1.5

      denominatorPriceFeed = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("8")).div(toBN(10).pow(toBN(18 - precision))),
          6,
          precision
        ),
        new PriceFeedMock(
          toBN(toWei("9")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("12")).div(toBN(10).pow(toBN(18 - precision))),
          7,
          precision
        ),
      ]);
      // Computes the median:
      // current: 5
      // historical: 10
      basketSpreadPriceFeed = new BasketSpreadPriceFeed(
        web3,
        dummyLogger,
        baselinePriceFeeds,
        experimentalPriceFeeds,
        noDenominator ? null : denominatorPriceFeed
      );
    }
    it("Default price precision", async function () {
      _constructPriceFeedsWithPrecision(18);

      // Current price calculation:
      // - Basket averaged prices:
      //     - baseline = 1.65
      //     - experimental = 1.3
      // - Spread price: 1 + 1.3 - 1.65 = 0.65
      // - Denominator price: 5
      // ===> Spread price divided by denominator: 0.13
      assert.equal(basketSpreadPriceFeed.getCurrentPrice().toString(), toWei("0.13"));

      // Historical price calculation (because we're using mocks, the timestamp doesn't matter).:
      // - Basket averaged prices:
      //     - baseline = 1.25
      //     - experimental = 1.5
      // - Spread price: 1 + 1.5 - 1.25 = 1.25
      // - Denominator price: 10
      // ===> Spread price divided by denominator: 0.125
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(await basketSpreadPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), toWei("0.125"));

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basketSpreadPriceFeed.getLastUpdateTime(), 650000);
      assert.equal(basketSpreadPriceFeed.getLookback(), 3600);
    });
    it("Custom price precision", async function () {
      // (same calculations and results as previous test, but precision should be different)
      _constructPriceFeedsWithPrecision(8);

      assert.equal(
        basketSpreadPriceFeed.getCurrentPrice().toString(),
        toBN(toWei("0.13"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(
        await basketSpreadPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp),
        toBN(toWei("0.125"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );
      assert.equal(basketSpreadPriceFeed.getLastUpdateTime(), 650000);
    });
    it("Skipping denominator price feed", async function () {
      // Same computation as first test except for last step where you divide by denominator, this
      // should skip that step. Recall that the denominator's current and historical price are:
      // 5 and 10 respectively.
      _constructPriceFeedsWithPrecision(6, true);

      assert.equal(
        basketSpreadPriceFeed.getCurrentPrice().toString(),
        toBN(toWei("0.65"))
          .div(toBN(10).pow(toBN(18 - 6)))
          .toString()
      );
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(
        await basketSpreadPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp),
        toBN(toWei("1.25"))
          .div(toBN(10).pow(toBN(18 - 6)))
          .toString()
      );
      assert.equal(basketSpreadPriceFeed.getLastUpdateTime(), 650000);
    });
  });
  describe("Returns floored value when spread is below 0", function () {
    // Basket averaged prices:
    // - baseline = 2.1
    // - experimental = 1
    // Spread price: 1 + 1 - 2.1 = -0.1
    // Denominator price: 5
    // Basket spread divided by denominator = 0

    function _constructPriceFeedsWithPrecision(precision) {
      const baselineFeeds1 = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("2.1")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("2.1")).div(toBN(10).pow(toBN(18 - precision))),
          200,
          precision
        ),
      ]);
      baselinePriceFeeds = [baselineFeeds1];
      // Average basket price = 2.1

      const experimentalFeeds1 = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          400,
          precision
        ),
      ]);
      experimentalPriceFeeds = [experimentalFeeds1];
      // Average basket price = 1

      denominatorPriceFeed = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("8")).div(toBN(10).pow(toBN(18 - precision))),
          6,
          precision
        ),
        new PriceFeedMock(
          toBN(toWei("9")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("12")).div(toBN(10).pow(toBN(18 - precision))),
          7,
          precision
        ),
      ]);
      // Computes the median:
      // current: 5
      // historical: 10
      basketSpreadPriceFeed = new BasketSpreadPriceFeed(
        web3,
        dummyLogger,
        baselinePriceFeeds,
        experimentalPriceFeeds,
        denominatorPriceFeed,
        precision
      );
    }
    it("Default price precision", async function () {
      _constructPriceFeedsWithPrecision(18);

      // Should return 0
      assert.equal(basketSpreadPriceFeed.getCurrentPrice().toString(), "0");

      // Should return 0 for historical price as well (because we're using mocks, the timestamp doesn't matter).
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(await basketSpreadPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), "0");

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basketSpreadPriceFeed.getLastUpdateTime(), 400);
    });
    it("Custom price precision", async function () {
      _constructPriceFeedsWithPrecision(8);

      // Should return the basket spread price divided by denominator
      assert.equal(basketSpreadPriceFeed.getCurrentPrice().toString(), "0");

      // Should return the same for historical price (because we're using mocks, the timestamp doesn't matter).
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(await basketSpreadPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), "0");

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basketSpreadPriceFeed.getLastUpdateTime(), 400);
    });
  });
  describe("Returns ceiling value when spread is above 2 0", function () {
    // Basket averaged prices:
    // - baseline = 1
    // - experimental = 2.1
    // Spread price: 1 + 2.1 - 1 = 2.1, which gets ceil'd to 2
    // Denominator price: 5 for current, 10 for historical
    // Basket spread divided by denominator = 0.4 for current, 0.2 for historical

    function _constructPriceFeedsWithPrecision(precision) {
      const baselineFeeds1 = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          200,
          precision
        ),
      ]);
      baselinePriceFeeds = [baselineFeeds1];
      // Average basket price = 1

      const experimentalFeeds1 = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("2.1")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("2.1")).div(toBN(10).pow(toBN(18 - precision))),
          400,
          precision
        ),
      ]);
      experimentalPriceFeeds = [experimentalFeeds1];
      // Average basket price = 2.1

      denominatorPriceFeed = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("8")).div(toBN(10).pow(toBN(18 - precision))),
          6,
          precision
        ),
        new PriceFeedMock(
          toBN(toWei("9")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("12")).div(toBN(10).pow(toBN(18 - precision))),
          7,
          precision
        ),
      ]); // Computes the median: 5
      basketSpreadPriceFeed = new BasketSpreadPriceFeed(
        web3,
        dummyLogger,
        baselinePriceFeeds,
        experimentalPriceFeeds,
        denominatorPriceFeed,
        precision
      );
    }
    it("Default price precision", async function () {
      _constructPriceFeedsWithPrecision(18);

      // Should return 0.4
      assert.equal(basketSpreadPriceFeed.getCurrentPrice().toString(), toWei("0.4"));

      // Should return the same for historical price (because we're using mocks, the timestamp doesn't matter).
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(await basketSpreadPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), toWei("0.2"));

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basketSpreadPriceFeed.getLastUpdateTime(), 400);
    });
    it("Custom price precision", async function () {
      _constructPriceFeedsWithPrecision(8);

      // Should return 0.4 in desired precision
      assert.equal(
        basketSpreadPriceFeed.getCurrentPrice().toString(),
        toBN(toWei("0.4"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );

      // Should return a historical price that is adjusted for the historical denominator price
      // (because we're using mocks, the timestamp doesn't matter).
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(
        await basketSpreadPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp),
        toBN(toWei("0.2"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basketSpreadPriceFeed.getLastUpdateTime(), 400);
    });
  });
  it("Constituent price feeds fail to return price", async function () {
    const priceFeeds = [new PriceFeedMock()];
    baselinePriceFeeds = [new MedianizerPriceFeed(priceFeeds), new MedianizerPriceFeed(priceFeeds)];
    experimentalPriceFeeds = [new MedianizerPriceFeed(priceFeeds), new MedianizerPriceFeed(priceFeeds)];
    denominatorPriceFeed = new MedianizerPriceFeed(priceFeeds);

    basketSpreadPriceFeed = new BasketSpreadPriceFeed(
      web3,
      dummyLogger,
      baselinePriceFeeds,
      experimentalPriceFeeds,
      denominatorPriceFeed
    );

    // Should return null.
    assert.equal(basketSpreadPriceFeed.getCurrentPrice(), null);

    // Should throw an error for each null price output.
    const arbitraryHistoricalTimestamp = 1000;
    try {
      basketSpreadPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp);
    } catch (err) {
      // Error messages should reflect a missing price
      assert.equal(err[0][0].message, "PriceFeedMock expected error thrown");
      assert.equal(err[1][0].message, "PriceFeedMock expected error thrown");
      assert.equal(err[2][0].message, "PriceFeedMock expected error thrown");
      assert.equal(err[3][0].message, "PriceFeedMock expected error thrown");
      assert.equal(err[4][0].message, "PriceFeedMock expected error thrown");
      assert.equal(err.length, 5);
    }

    // Should return null.
    assert.equal(basketSpreadPriceFeed.getLastUpdateTime(), null);
  });
  it("Validates constituent price feed decimals", async function () {
    // Test that the BasketSpreadPriceFeed rejects any constituent price feeds where the decimals do not match up with the
    // denominator price feed.
    const priceFeeds = [new PriceFeedMock()];
    const differentPrecisionPriceFeeds = [new PriceFeedMock(undefined, undefined, 0, 8)];
    baselinePriceFeeds = [new MedianizerPriceFeed(priceFeeds), new MedianizerPriceFeed(priceFeeds)];
    experimentalPriceFeeds = [new MedianizerPriceFeed(priceFeeds), new MedianizerPriceFeed(priceFeeds)];
    denominatorPriceFeed = new MedianizerPriceFeed(priceFeeds);

    const validBasketPriceFeed = new BasketSpreadPriceFeed(
      web3,
      dummyLogger,
      baselinePriceFeeds,
      experimentalPriceFeeds,
      denominatorPriceFeed
    );

    let didThrow = false;
    try {
      const feedDecimals = validBasketPriceFeed.getPriceFeedDecimals();
      assert.equal(feedDecimals, 18);
    } catch (error) {
      didThrow = true;
    }

    assert.isFalse(didThrow);

    const invalidExperimentalPriceFeeds = [
      new MedianizerPriceFeed(differentPrecisionPriceFeeds),
      new MedianizerPriceFeed(differentPrecisionPriceFeeds),
    ];
    const invalidBasketPriceFeed = new BasketSpreadPriceFeed(
      web3,
      dummyLogger,
      baselinePriceFeeds,
      invalidExperimentalPriceFeeds,
      denominatorPriceFeed
    );
    try {
      invalidBasketPriceFeed.getPriceFeedDecimals();
    } catch (error) {
      didThrow = true;
    }
    assert.isTrue(didThrow);
  });
});
