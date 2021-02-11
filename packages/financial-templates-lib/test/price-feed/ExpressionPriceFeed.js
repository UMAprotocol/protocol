const { toWei, toBN } = web3.utils;
const { ExpressionPriceFeed, escapeSpecialCharacters, math } = require("../../src/price-feed/ExpressionPriceFeed");
const { PriceFeedMock } = require("../../src/price-feed/PriceFeedMock");

contract("ExpressionPriceFeed.js", function() {
  it("Update", async function() {
    const priceFeedMap = {
      ETHUSD: new PriceFeedMock(),
      BTCUSD: new PriceFeedMock()
    };

    const expressionPriceFeed = new ExpressionPriceFeed(priceFeedMap, "ETHUSD + BTCUSD");
    await expressionPriceFeed.update();
    await expressionPriceFeed.update();

    assert.equal(priceFeedMap.ETHUSD.updateCalled, 2);
    assert.equal(priceFeedMap.BTCUSD.updateCalled, 2);
  });

  it("Basic expression", async function() {
    const priceFeedMap = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals   lookback
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18, 500),
      BTCUSD: new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000, 18, 4000),
      COMPUSD: new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25, 18, 50000)
    };

    const expressionPriceFeed = new ExpressionPriceFeed(priceFeedMap, "ETHUSD + BTCUSD + COMPUSD");

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

  it("Complex expression", async function() {
    const priceFeedMap = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18),
      BTCUSD: new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000, 18),
      COMPUSD: new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25, 18)
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

  it("sub-pricefeeds fail to return price", async function() {
    const priceFeeds = {
      //                currentPrice      historicalPrice    lastUpdatedTime
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("17")), 100),
      BTCUSD: new PriceFeedMock(null, null, null),
      COMPUSD: new PriceFeedMock(null, null, null)
    };

    const expressionPriceFeed = new ExpressionPriceFeed(priceFeeds, "ETHUSD * BTCUSD * COMPUSD");

    // Should return null since there was a null price output.
    assert.equal(expressionPriceFeed.getCurrentPrice(), null);

    // Should throw an error for each null price output.
    const arbitraryHistoricalTimestamp = 1000;
    await expressionPriceFeed.getHistoricalPrice(arbitraryHistoricalTimestamp).then(
      () => assert.fail(),
      err => {
        assert.equal(err[0].message, "PriceFeedMock expected error thrown");
        assert.equal(err[1].message, "PriceFeedMock expected error thrown");
        assert.equal(err.length, 2);
      }
    );

    // Should return null since there was a null input.
    assert.equal(expressionPriceFeed.getLastUpdateTime(), null);
  });

  it("undefined inputs", async function() {
    const priceFeeds = {
      //                currentPrice      historicalPrice    lastUpdatedTime
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("17")), 100),
      BTCUSD: new PriceFeedMock(undefined, undefined, undefined)
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

  it("Validates feeds decimals correctly", async function() {
    const validDecimalsPriceFeeds = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18),
      BTCUSD: new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000, 18, 4000),
      COMPUSD: new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25, 18, 50000)
    };

    const validExpressionPriceFeed = new ExpressionPriceFeed(validDecimalsPriceFeeds, "ETHUSD * BTCUSD * COMPUSD");
    assert.equal(validExpressionPriceFeed.getPriceFeedDecimals(), 18);

    // Create three feeds, one with a diffrent number of decimals. Medianizer should reject this when checking the decimals.
    const inValidDecimalsPriceFeeds = {
      //                        currentPrice      historicalPrice    lastUpdatedTime   decimals
      ETHUSD: new PriceFeedMock(toBN(toWei("1")), toBN(toWei("25")), 100, 18),
      BTCUSD: new PriceFeedMock(toBN(toWei("2")), toBN(toWei("57")), 50000, 18),
      COMPUSD: new PriceFeedMock(toBN(toWei("9")), toBN(toWei("10")), 25, 17)
    };

    const invalidExpressionPriceFeed = new ExpressionPriceFeed(inValidDecimalsPriceFeeds, "ETHUSD * BTCUSD * COMPUSD");
    assert.throws(() => invalidExpressionPriceFeed.getPriceFeedDecimals());
  });

  describe("Expression parsing with escaped characters", async function() {
    it("Escapes characters correctly", async function() {
      assert.equal(escapeSpecialCharacters("USD-[bwBTC/ETH SLP]"), "USD\\-\\[bwBTC\\/ETH\\ SLP\\]");
      assert.equal(escapeSpecialCharacters("-/][a--]rr]"), "\\-\\/\\]\\[a\\-\\-\\]rr\\]");
    });

    it("Processes escaped expressions correctly", async function() {
      const escapedSymbol = "\\[1\\/\\-2\\]\\ \\-\\ 17";
      assert.equal(math.evaluate(`${escapedSymbol} - 2 * ${escapedSymbol}`, { [escapedSymbol]: 5 }).toString(), "-5");

      const unescapedSymbol = "USD-[bwBTC/ETH SLP]";
      assert.equal(
        math
          .evaluate(`${escapeSpecialCharacters(unescapedSymbol)} - ${escapedSymbol}`, {
            [escapedSymbol]: 10,
            [escapeSpecialCharacters(unescapedSymbol)]: 15
          })
          .toString(),
        "5"
      );
    });
  });
});
