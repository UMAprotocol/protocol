const winston = require("winston");

const { toWei, toBN } = web3.utils;

const { MedianizerPriceFeed } = require("../../src/price-feed/MedianizerPriceFeed");
const { BasisPriceFeed } = require("../../src/price-feed/BasisPriceFeed");
const { PriceFeedMock } = require("../../src/price-feed/PriceFeedMock");

contract("BasisPriceFeed.js", function() {
  let futurePriceFeeds;
  let spotPriceFeeds;
  let dummyLogger;
  let basisPriceFeed;
  let lowerBound = 70;
  let upperBound = 130;

  beforeEach(async function() {
    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });
  });
  it("Update", async function() {
    const priceFeeds = [new PriceFeedMock()];
    futurePriceFeeds = [new MedianizerPriceFeed(priceFeeds), new MedianizerPriceFeed(priceFeeds)];
    spotPriceFeeds = [new MedianizerPriceFeed(priceFeeds), new MedianizerPriceFeed(priceFeeds)];

    basisPriceFeed = new BasisPriceFeed(web3, dummyLogger, futurePriceFeeds, spotPriceFeeds, lowerBound, upperBound);

    await basisPriceFeed.update();

    // On the basket spread's update call, `priceFeeds[0]` should have been updated once for each
    // Medianizer price feed that it is incorporated in. This is because the basket spread price feed
    // updates its imported medianizer price feeds.
    // Check work: 2x for future update, 2x spot udpate = 4 total.
    assert.equal(priceFeeds[0].updateCalled, 4);
  });
  describe("Computing basket spreads when the spread is within the range [lowerBound,upperBound]", function() {
    function _constructPriceFeedsWithPrecision(precision) {
      // First let's construct the constituent pricefeeds of the baskets.
      const futureFeeds1 = new MedianizerPriceFeed(
        [
          //                currentPrice      historicalPrice    lastUpdatedTime
          new PriceFeedMock(
            toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.1")).div(toBN(10).pow(toBN(18 - precision))),
            200,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("1.5")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("1.5")).div(toBN(10).pow(toBN(18 - precision))),
            55000,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("2")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("2.9")).div(toBN(10).pow(toBN(18 - precision))),
            50,
            precision
          )
        ],
        false
      );
      // Computes the median:
      const futureFeeds2 = new MedianizerPriceFeed(
        [
          //                currentPrice      historicalPrice    lastUpdatedTime
          new PriceFeedMock(
            toBN(toWei("1.9")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("1.5")).div(toBN(10).pow(toBN(18 - precision))),
            200,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("2.1")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("2.1")).div(toBN(10).pow(toBN(18 - precision))),
            55000,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("2.3")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("2.7")).div(toBN(10).pow(toBN(18 - precision))),
            50,
            precision
          )
        ],
        true
      );
      // Computes the mean:
      // current: 2.1
      // historical: 2.1

      futurePriceFeeds = [futureFeeds1, futureFeeds2];
      // Average basket price:
      // current: 1.8
      // historical: 1.8

      const spotFeeds1 = new MedianizerPriceFeed(
        [
          //                currentPrice      historicalPrice    lastUpdatedTime
          new PriceFeedMock(
            toBN(toWei("0.6")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.7")).div(toBN(10).pow(toBN(18 - precision))),
            400,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("0.4")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.4")).div(toBN(10).pow(toBN(18 - precision))),
            60000,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("0.2")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.1")).div(toBN(10).pow(toBN(18 - precision))),
            100,
            precision
          )
        ],
        false
      );
      // Computes the median:
      // current: 0.4
      // historical: 0.4
      const spotFeeds2 = new MedianizerPriceFeed(
        [
          //                currentPrice      historicalPrice    lastUpdatedTime
          new PriceFeedMock(
            toBN(toWei("0.9")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("0.2")).div(toBN(10).pow(toBN(18 - precision))),
            800,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("1.4")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("1.4")).div(toBN(10).pow(toBN(18 - precision))),
            650000,
            precision
          ),
          new PriceFeedMock(
            toBN(toWei("1.9")).div(toBN(10).pow(toBN(18 - precision))),
            toBN(toWei("2.6")).div(toBN(10).pow(toBN(18 - precision))),
            200,
            precision
          )
        ],
        true
      );
      // Computes the mean:
      // current: 1.4
      // historical: 1.4

      spotPriceFeeds = [spotFeeds1, spotFeeds2];
      // Average basket price:
      // current: 0.9
      // historical: 0.9

      basisPriceFeed = new BasisPriceFeed(web3, dummyLogger, spotPriceFeeds, futurePriceFeeds, 70, 230);
    }
    it("Default price precision", async function() {
      _constructPriceFeedsWithPrecision(18);

      assert.equal(basisPriceFeed.getCurrentPrice().toString(), toWei("200"));

      // Historical price calculation (because we're using mocks, the timestamp doesn't matter).:
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(basisPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), toWei("200"));

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basisPriceFeed.getLastUpdateTime(), 650000);
      assert.equal(basisPriceFeed.getLookback(), 3600);
    });
    it("Custom price precision", async function() {
      // (same calculations and results as previous test, but precision should be different)
      _constructPriceFeedsWithPrecision(8);

      assert.equal(
        basisPriceFeed.getCurrentPrice().toString(),
        toBN(toWei("200"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(
        basisPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp),
        toBN(toWei("200"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );
      assert.equal(basisPriceFeed.getLastUpdateTime(), 650000);
    });
  });
  describe("Returns floored value when spread is below lowerBound", function() {
    // Basket averaged prices:
    // - future = 1
    // - spot = 5
    // Basis price: 100 * (1 + (1 - 5)/5) = 20

    function _constructPriceFeedsWithPrecision(precision) {
      const futureFeeds1 = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          200,
          precision
        )
      ]);
      futurePriceFeeds = [futureFeeds1];
      // Average basket price = 1

      const spotFeeds1 = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("5")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("5")).div(toBN(10).pow(toBN(18 - precision))),
          400,
          precision
        )
      ]);
      spotPriceFeeds = [spotFeeds1];
      // Average basket price = 5

      // Computes the median:
      basisPriceFeed = new BasisPriceFeed(
        web3,
        dummyLogger,
        spotPriceFeeds,
        futurePriceFeeds,
        lowerBound,
        upperBound,
        precision
      );
    }
    it("Default price precision", async function() {
      _constructPriceFeedsWithPrecision(18);

      // Should return 0
      assert.equal(basisPriceFeed.getCurrentPrice().toString(), toWei("70"));

      // Should return 0 for historical price as well (because we're using mocks, the timestamp doesn't matter).
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(basisPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), toWei("70"));

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basisPriceFeed.getLastUpdateTime(), 400);
    });
    it("Custom price precision", async function() {
      _constructPriceFeedsWithPrecision(8);

      assert.equal(
        basisPriceFeed.getCurrentPrice().toString(),
        toBN(toWei("70"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );

      // Should return the same for historical price (because we're using mocks, the timestamp doesn't matter).
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(
        basisPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp),
        toBN(toWei("70"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basisPriceFeed.getLastUpdateTime(), 400);
    });
  });
  describe("Returns ceiling value when spread is above upperBound", function() {
    // Basket averaged prices:
    // - future = 11
    // - spot = 1
    // Basis Price: 100 * (1 + (11 - 1)/1) = 1100, which gets floored to 130

    function _constructPriceFeedsWithPrecision(precision) {
      const futureFeeds1 = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("11")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("11")).div(toBN(10).pow(toBN(18 - precision))),
          200,
          precision
        )
      ]);
      futurePriceFeeds = [futureFeeds1];
      // Average basket price = 11

      const spotFeeds1 = new MedianizerPriceFeed([
        //                currentPrice      historicalPrice    lastUpdatedTime
        new PriceFeedMock(
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          toBN(toWei("1")).div(toBN(10).pow(toBN(18 - precision))),
          400,
          precision
        )
      ]);
      spotPriceFeeds = [spotFeeds1];

      basisPriceFeed = new BasisPriceFeed(
        web3,
        dummyLogger,
        spotPriceFeeds,
        futurePriceFeeds,
        lowerBound,
        upperBound,
        precision
      );
    }
    it("Default price precision", async function() {
      _constructPriceFeedsWithPrecision(18);

      assert.equal(basisPriceFeed.getCurrentPrice().toString(), toWei("130"));

      // Should return the same for historical price (because we're using mocks, the timestamp doesn't matter).
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(basisPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), toWei("130"));

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basisPriceFeed.getLastUpdateTime(), 400);
    });
    it("Custom price precision", async function() {
      _constructPriceFeedsWithPrecision(8);

      assert.equal(
        basisPriceFeed.getCurrentPrice().toString(),
        toBN(toWei("130"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );

      // Should return a historical price that is adjusted for the historical denominator price
      // (because we're using mocks, the timestamp doesn't matter).
      const arbitraryHistoricalTimestamp = 1000;
      assert.equal(
        basisPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp),
        toBN(toWei("130"))
          .div(toBN(10).pow(toBN(18 - 8)))
          .toString()
      );

      // Should return the *maximum* lastUpdatedTime.
      assert.equal(basisPriceFeed.getLastUpdateTime(), 400);
    });
  });
});
