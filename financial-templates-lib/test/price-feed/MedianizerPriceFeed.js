const { toWei, toBN } = web3.utils;

const { MedianizerPriceFeed } = require("../../price-feed/MedianizerPriceFeed");
const { PriceFeedMock } = require("./PriceFeedMock.js");

contract("MedianizerPriceFeed.js", function(accounts) {
  it("Basic medians", async function() {
    const priceFeeds = [
      //                currentPrice      historicalPrice    lastUpdatedTime
      new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100),
      new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000),
      new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25)
    ];
  });
});
