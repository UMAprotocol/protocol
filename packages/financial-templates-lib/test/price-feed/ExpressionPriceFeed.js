const { web3 } = require("hardhat");
const { assert } = require("chai");
const { toWei, toBN } = web3.utils;
const { ExpressionPriceFeed, escapeSpecialCharacters, math } = require("../../dist/price-feed/ExpressionPriceFeed");
const { PriceFeedMock } = require("../../dist/price-feed/PriceFeedMock");

describe("ExpressionPriceFeed.js", function () {
  it("Update", async function () {
    const priceFeedMap = { ETHUSD: new PriceFeedMock(), BTCUSD: new PriceFeedMock() };

    const expressionPriceFeed = new ExpressionPriceFeed(priceFeedMap, "ETHUSD + BTCUSD");
    await expressionPriceFeed.update();
    await expressionPriceFeed.update();

    assert.equal(priceFeedMap.ETHUSD.updateCalled, 2);
    assert.equal(priceFeedMap.BTCUSD.updateCalled, 2);
  });

  it("Basic expression", async function () {
    // Note: the third price feed's name is meant to be a complex name with many special characters to demonstrate
    // that it works.
    const priceFeedMap = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals   lookback
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18, 500),
      BTCUSD: new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000, 18, 4000),
      "USD\\-\\[bwBTC\\/ETH\\ SLP\\]": new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25, 18, 50000),
    };

    const expressionPriceFeed = new ExpressionPriceFeed(
      priceFeedMap,
      "ETHUSD + BTCUSD + USD\\-\\[bwBTC\\/ETH\\ SLP\\]"
    );

    // Should return the sum of the current prices.
    assert.equal(expressionPriceFeed.getCurrentPrice(), toWei("12"));

    // Should return the summed historical price (because we're using mocks, the timestamp doesn't matter).
    const arbitraryHistoricalTimestamp = 1000;
    assert.equal(await expressionPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp), toWei("92"));

    // Should return the *maximum* lastUpdatedTime.
    assert.equal(expressionPriceFeed.getLastUpdateTime(), 50000);

    // Should return the min lookback.
    assert.equal(expressionPriceFeed.getLookback(), 500);
  });

  it("Complex expression", async function () {
    const priceFeedMap = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18),
      BTCUSD: new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000, 18),
      COMPUSD: new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25, 18),
    };

    const expressionPriceFeed = new ExpressionPriceFeed(
      priceFeedMap,
      "(ETHUSD + COMPUSD) * (BTCUSD + COMPUSD) / 7.321"
    );

    // Should return the sum of the current prices.
    // (1 + 9) * (2 + 9) / 7.321 = 15.025269771889086190 (rounded to 18 decimals).
    assert.equal(expressionPriceFeed.getCurrentPrice(), toWei("15.025269771889086190"));

    // Should return the summed historical price (because we're using mocks, the timestamp doesn't matter).
    const arbitraryHistoricalTimestamp = 1000;
    // (25 + 10) * (57 + 10) / 7.321 = 320.311432864362791968 (rounded to 18 decimals).
    assert.equal(
      await expressionPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp),
      toWei("320.311432864362791968")
    );
  });

  it("sub-pricefeeds fail to return price", async function () {
    const priceFeeds = {
      //                currentPrice      historicalPrice    lastUpdatedTime
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("17")), 100),
      BTCUSD: new PriceFeedMock(null, null, null),
      COMPUSD: new PriceFeedMock(null, null, null),
    };

    const expressionPriceFeed = new ExpressionPriceFeed(priceFeeds, "ETHUSD * BTCUSD * COMPUSD");

    // Should return null since there was a null price output.
    assert.equal(expressionPriceFeed.getCurrentPrice(), null);

    // Should throw an error for each null price output.
    const arbitraryHistoricalTimestamp = 1000;
    await expressionPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp).then(
      () => assert.fail(),
      (err) => {
        assert.isTrue(err[0].message.includes("PriceFeedMock"));
        assert.isTrue(err[1].message.includes("PriceFeedMock"));
        assert.equal(err.length, 2);
      }
    );

    // Should return null since there was a null input.
    assert.equal(expressionPriceFeed.getLastUpdateTime(), null);
  });

  it("undefined inputs", async function () {
    const priceFeeds = {
      //                currentPrice      historicalPrice    lastUpdatedTime
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("17")), 100),
      BTCUSD: new PriceFeedMock(undefined, undefined, undefined),
    };

    const expressionPriceFeed = new ExpressionPriceFeed(priceFeeds, "ETHUSD * BTCUSD * COMPUSD");

    // Should return null since there was an undefined price output.
    assert.equal(expressionPriceFeed.getCurrentPrice(), null);

    // Should throw since there was an undefined price output.
    const arbitraryHistoricalTimestamp = 1000;
    assert.isTrue(await expressionPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp).catch(() => true));

    // Should return null since there was an undefined output.
    assert.equal(expressionPriceFeed.getLastUpdateTime(), null);
  });
  it("Simple decimal conversion", async function () {
    const priceFeedDecimalsMatching = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals
      ETHUSD: new PriceFeedMock(toBN("1"), toBN("25626"), 100, 1),
    };

    const expressionPriceFeed = new ExpressionPriceFeed(priceFeedDecimalsMatching, "ETHUSD", 18);

    assert.equal(expressionPriceFeed.getCurrentPrice().toString(), toWei("0.1"));
    assert.equal((await expressionPriceFeed.getHistoricalPrice(1000)).toString(), toWei("2562.6"));
  });

  it("Complex decimal conversion math", async function () {
    // The first price feed matches all the input decimals.
    // Note: these values are tailored to match the price feeds below.
    const priceFeedDecimalsMatching = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals
      ETHUSD: new PriceFeedMock(toBN(toWei(".01")), toBN(toWei(".25")), 100, 16),
      BTCUSD: new PriceFeedMock(toBN(toWei(".02")), toBN(toWei(".57")), 50000, 16, 4000),
      COMPUSD: new PriceFeedMock(toBN(toWei(".09")), toBN(toWei(".1")), 25, 16, 50000),
    };

    const expressionPriceFeedMatching = new ExpressionPriceFeed(
      priceFeedDecimalsMatching,
      "ETHUSD * BTCUSD * COMPUSD",
      16
    );
    assert.equal(expressionPriceFeedMatching.getPriceFeedDecimals(), 16);

    // Create three feeds, one with a diffrent number of decimals. Expression feed should correctly convert these to the provided decimals.
    const priceFeedDecimalsNotMatching = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18),
      BTCUSD: new PriceFeedMock(toBN("20"), toBN("570"), 50000, 1),
      COMPUSD: new PriceFeedMock(toBN(toWei(".9")), toBN(toWei("1")), 25, 17),
    };

    const expressionPriceFeedNotMatching = new ExpressionPriceFeed(
      priceFeedDecimalsNotMatching,
      "ETHUSD * BTCUSD * COMPUSD",
      16
    );
    assert.equal(expressionPriceFeedNotMatching.getPriceFeedDecimals(), 16);

    // Ensure price feeds have exactly the same outputs despite having inputs of different decimal values.
    await expressionPriceFeedMatching.update();
    await expressionPriceFeedNotMatching.update();
    assert.equal(
      expressionPriceFeedNotMatching.getCurrentPrice().toString(),
      expressionPriceFeedMatching.getCurrentPrice().toString()
    );
    assert.equal(
      (await expressionPriceFeedNotMatching.getHistoricalPrice(50)).toString(),
      (await expressionPriceFeedMatching.getHistoricalPrice(50)).toString()
    );
  });

  it("Multiline expression", async function () {
    const priceFeedMap = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18),
      BTCUSD: new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000, 18),
      COMPUSD: new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25, 18),
    };

    const multiLineExpressions = [
      `
      ETHCOMPSUM = ETHUSD + COMPUSD;
      BTCCOMPSUM = BTCUSD + COMPUSD;
      ETHCOMPSUM * BTCCOMPSUM / 7.321
      `,
      `
      ETHCOMPSUM = ETHUSD + COMPUSD
      BTCCOMPSUM = BTCUSD + COMPUSD
      ETHCOMPSUM * BTCCOMPSUM / 7.321
      `,
      "ETHCOMPSUM = ETHUSD + COMPUSD; BTCCOMPSUM = BTCUSD + COMPUSD; ETHCOMPSUM * BTCCOMPSUM / 7.321",
      "ETHCOMPSUM = ETHUSD + COMPUSD\n BTCCOMPSUM = BTCUSD + COMPUSD\n ETHCOMPSUM * BTCCOMPSUM / 7.321",
    ];

    const priceFeeds = multiLineExpressions.map((expression) => new ExpressionPriceFeed(priceFeedMap, expression));

    // All of the different multiline expressions should return the same thing.
    // (1 + 9) * (2 + 9) / 7.321 = 15.025269771889086190 (rounded to 18 decimals).
    priceFeeds.forEach((pf) => assert.equal(pf.getCurrentPrice(), toWei("15.025269771889086190")));

    // Should return the summed historical price (because we're using mocks, the timestamp doesn't matter).
    const arbitraryHistoricalTimestamp = 1000;
    // (25 + 10) * (57 + 10) / 7.321 = 320.311432864362791968 (rounded to 18 decimals).
    await Promise.all(
      priceFeeds.map(async (pf) =>
        assert.equal(await pf.getHistoricalPrice(arbitraryHistoricalTimestamp), toWei("320.311432864362791968"))
      )
    );
  });

  describe("Expression parsing with escaped characters", async function () {
    it("Escapes characters correctly", async function () {
      assert.equal(escapeSpecialCharacters("USD-[bwBTC/ETH SLP]"), "USD\\-\\[bwBTC\\/ETH\\ SLP\\]");
      assert.equal(escapeSpecialCharacters("-/][a--]rr]"), "\\-\\/\\]\\[a\\-\\-\\]rr\\]");
    });

    it("Processes escaped expressions correctly", async function () {
      const escapedSymbol = "\\[1\\/\\-2\\]\\ \\-\\ 17";
      assert.equal(math.evaluate(`${escapedSymbol} - 2 * ${escapedSymbol}`, { [escapedSymbol]: 5 }).toString(), "-5");

      const unescapedSymbol = "USD-[bwBTC/ETH SLP]";
      assert.equal(
        math
          .evaluate(`${escapeSpecialCharacters(unescapedSymbol)} - ${escapedSymbol}`, {
            [escapedSymbol]: 10,
            [escapeSpecialCharacters(unescapedSymbol)]: 15,
          })
          .toString(),
        "5"
      );
    });
  });
});
