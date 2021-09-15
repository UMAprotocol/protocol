const { web3 } = require("hardhat");
const { assert } = require("chai");
const { toWei, toBN } = web3.utils;

const { FallBackPriceFeed } = require("../../dist/price-feed/FallBackPriceFeed");
const { PriceFeedMock } = require("../../dist/price-feed/PriceFeedMock");
const { InvalidPriceFeedMock } = require("../../dist/price-feed/InvalidPriceFeedMock");

describe("FallBackPriceFeed.js", function () {
  let fallBackPriceFeed;
  describe("First pricefeed is valid", function () {
    let priceFeeds, fallBackPriceFeed;
    beforeEach(async function () {
      //                currentPrice      historicalPrice    lastUpdatedTime
      priceFeeds = [
        new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100),
        new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000),
      ];
      fallBackPriceFeed = new FallBackPriceFeed(priceFeeds);
    });
    it("(update)", async function () {
      try {
        await fallBackPriceFeed.update();
        await fallBackPriceFeed.update();

        // All pricefeed update methods are called.
        assert.equal(priceFeeds[0].updateCalled, 2);
        assert.equal(priceFeeds[1].updateCalled, 2);
      } catch (err) {
        // No errors should be thrown:
        assert(false, "update should not throw if at least one succeeded");
      }
    });
    it("(getCurrentPrice)", async function () {
      const currentPrice = fallBackPriceFeed.getCurrentPrice();
      assert.equal(currentPrice.toString(), toWei("1"));
    });
    it("(getLastUpdateTime)", async function () {
      const lastUpdateTime = fallBackPriceFeed.getLastUpdateTime();
      // Returns max successfully fetched update time.
      assert.equal(lastUpdateTime, 50000);
    });
    it("(getHistoricalPrice)", async function () {
      const arbitraryHistoricalTimestamp = 1000;
      const historicalPrice = await fallBackPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp);
      assert.equal(historicalPrice.toString(), toWei("25"));
    });
  });
  describe("First pricefeed is invalid", function () {
    let priceFeeds, fallBackPriceFeed;
    beforeEach(async function () {
      //                currentPrice      historicalPrice    lastUpdatedTime
      priceFeeds = [
        new InvalidPriceFeedMock(null, null, null, true),
        new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000),
        new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100),
      ];

      fallBackPriceFeed = new FallBackPriceFeed(priceFeeds);
    });
    it("(update)", async function () {
      await fallBackPriceFeed.update();
      await fallBackPriceFeed.update();

      // The first pricefeed's update() method will fail, but that error should be caught and
      // not cause the other updates to fail.
      assert.equal(priceFeeds[1].updateCalled, 2);
      assert.equal(priceFeeds[2].updateCalled, 2);
    });
    it("(getCurrentPrice)", async function () {
      const currentPrice = fallBackPriceFeed.getCurrentPrice();
      assert.equal(currentPrice.toString(), toWei("2"));
    });
    it("(getLastUpdateTime)", async function () {
      const lastUpdateTime = fallBackPriceFeed.getLastUpdateTime();
      assert.equal(lastUpdateTime, 50000);
    });
    it("(getHistoricalPrice)", async function () {
      const arbitraryHistoricalTimestamp = 1000;
      const historicalPrice = await fallBackPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp);
      assert.equal(historicalPrice.toString(), toWei("57"));
    });
  });
  describe("All pricefeeds are invalid", function () {
    let priceFeeds;
    beforeEach(async function () {
      //                currentPrice      historicalPrice    lastUpdatedTime
      priceFeeds = [new InvalidPriceFeedMock(null, null, null, true), new InvalidPriceFeedMock(null, null, null, true)];

      fallBackPriceFeed = new FallBackPriceFeed(priceFeeds);
    });
    it("(update)", async function () {
      // If all updates throw, then all constituent errors should be thrown.
      fallBackPriceFeed.update().catch((errs) => {
        assert.equal(errs.length, 2);
        errs.forEach((err) => {
          assert.isTrue(err.message.includes("expected update failure"));
        });
      });
    });
    it("(getCurrentPrice)", async function () {
      assert.equal(fallBackPriceFeed.getCurrentPrice(), null);
    });
    it("(getLastUpdateTime)", async function () {
      assert.equal(fallBackPriceFeed.getLastUpdateTime(), null);
    });
    it("(getHistoricalPrice)", async function () {
      const arbitraryHistoricalTimestamp = 1000;
      fallBackPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp).catch((errs) => {
        assert.equal(errs.length, 2);
        errs.forEach((err) => {
          assert.isTrue(err.message.includes("expected missing historical price"));
        });
      });
    });
  });
  it("Validates feeds decimals correctly", async function () {
    // Create three feeds, one with a diffrent number of decimals. Medianizer should reject this when checking the decimals.
    const validDecimalsPriceFeeds = [
      //                currentPrice      historicalPrice    lastUpdatedTime    PriceFeed decimals
      new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18),
      new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000, 18),
      new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25, 18),
    ];

    fallBackPriceFeed = new FallBackPriceFeed(validDecimalsPriceFeeds);

    let didThrow = false;
    try {
      const feedDecimals = fallBackPriceFeed.getPriceFeedDecimals();
      assert.equal(feedDecimals, 18);
    } catch (error) {
      didThrow = true;
    }
    assert.isFalse(didThrow);

    const inValidDecimalsPriceFeeds = [
      //                currentPrice      historicalPrice    lastUpdatedTime    PriceFeed decimals
      new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18),
      new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000, 18),
      new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25, 17),
    ];

    fallBackPriceFeed = new FallBackPriceFeed(inValidDecimalsPriceFeeds);
    try {
      fallBackPriceFeed.getPriceFeedDecimals();
    } catch (error) {
      didThrow = true;
    }
    assert.isTrue(didThrow);
  });
});
