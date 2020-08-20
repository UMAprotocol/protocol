const { toWei, toBN } = web3.utils;

const { MedianizerPriceFeed } = require("../../src/price-feed/MedianizerPriceFeed");
const { PriceFeedMock } = require("../../src/price-feed/PriceFeedMock");

contract("MedianizerPriceFeed.js", function(accounts) {
  it("Update", async function() {
    const priceFeeds = [new PriceFeedMock()];

    const medianizerPriceFeed = new MedianizerPriceFeed(priceFeeds);
    await medianizerPriceFeed.update();
    await medianizerPriceFeed.update();

    assert.equal(priceFeeds[0].updateCalled, 2);
  });

  it("Basic medians", async function() {
    const priceFeeds = [
      //                currentPrice      historicalPrice    lastUpdatedTime
      new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100),
      new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000),
      new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25)
    ];

    const medianizerPriceFeed = new MedianizerPriceFeed(priceFeeds);

    // Should return the median current price.
    assert.equal(medianizerPriceFeed.getCurrentPrice(), toWei("2"));

    // Should return the median historical price (because we're using mocks, the timestamp doesn't matter).
    const arbitraryHistoricalTimestamp = 1000;
    assert.equal(medianizerPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), toWei("25"));

    // Should return the *maximum* lastUpdatedTime.
    assert.equal(medianizerPriceFeed.getLastUpdateTime(), 50000);
  });

  it("Even count median", async function() {
    const priceFeeds = [
      //                currentPrice      historicalPrice    lastUpdatedTime
      new PriceFeedMock(toBN(toWei("1")), toBN(toWei("17")), 100),
      new PriceFeedMock(toBN(toWei("2")), toBN(toWei("58")), 50000),
      new PriceFeedMock(toBN(toWei("3")), toBN(toWei("45")), 25),
      new PriceFeedMock(toBN(toWei("4")), toBN(toWei("100")), 25)
    ];

    const medianizerPriceFeed = new MedianizerPriceFeed(priceFeeds);

    // Should return the average of 3 and 2 since there are an even number of elements.
    assert.equal(medianizerPriceFeed.getCurrentPrice(), toWei("2.5"));

    // Should return the average of 58 and 45 since there are an even number of elements.
    // Note: because we're using mocks, the timestamp doesn't matter.
    const arbitraryHistoricalTimestamp = 1000;
    assert.equal(medianizerPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), toWei("51.5"));
  });

  it("null inputs", async function() {
    const priceFeeds = [
      //                currentPrice      historicalPrice    lastUpdatedTime
      new PriceFeedMock(toBN(toWei("1")), toBN(toWei("17")), 100),
      new PriceFeedMock(null, null, null)
    ];

    const medianizerPriceFeed = new MedianizerPriceFeed(priceFeeds);

    // Should return null since there was a null price output.
    assert.equal(medianizerPriceFeed.getCurrentPrice(), null);

    // Should return null since there was a null price output.
    const arbitraryHistoricalTimestamp = 1000;
    assert.equal(medianizerPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), null);

    // Should return null since there was a null input.
    assert.equal(medianizerPriceFeed.getLastUpdateTime(), null);
  });

  it("undefined inputs", async function() {
    const priceFeeds = [
      //                currentPrice      historicalPrice    lastUpdatedTime
      new PriceFeedMock(toBN(toWei("1")), toBN(toWei("17")), 100),
      new PriceFeedMock(undefined, undefined, undefined)
    ];

    const medianizerPriceFeed = new MedianizerPriceFeed(priceFeeds);

    // Should return null since there was an undefined price output.
    assert.equal(medianizerPriceFeed.getCurrentPrice(), null);

    // Should return null since there was an undefined price output.
    const arbitraryHistoricalTimestamp = 1000;
    assert.equal(medianizerPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), null);

    // Should return null since there was an undefined output.
    assert.equal(medianizerPriceFeed.getLastUpdateTime(), null);
  });
});
