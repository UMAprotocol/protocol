const { web3 } = require("hardhat");
const { assert } = require("chai");
const { CoinMarketCapPriceFeed } = require("../../dist/price-feed/CoinMarketCapPriceFeed");
const { NetworkerMock } = require("../../dist/price-feed/NetworkerMock");
const winston = require("winston");
const { parseFixed } = require("@uma/common");

const Convert = (decimals) => (number) => parseFixed(number.toString().substring(0, decimals), decimals).toString();

describe("CoinMarketCapPriceFeed.js", function () {
  let coinMarketCapPriceFeed;
  let networker;
  let mockTime;

  const apiKey = "test-api-key";
  const symbol = "DAI";
  const convert = "PHP";
  const lookback = 120; // 2 minutes.
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 60;
  const priceFeedDecimals = 18;

  const { toWei, toBN } = web3.utils;

  const mockPrice = 48.200162117610525;
  const validResponse = { data: { [symbol]: { quote: { [convert]: { price: mockPrice } } } } };

  beforeEach(async function () {
    networker = new NetworkerMock();
    mockTime = new Date().getTime();

    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    coinMarketCapPriceFeed = new CoinMarketCapPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      symbol,
      convert,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      priceFeedDecimals
    );
  });

  it("getCurrentPrice() returns the latest price", async function () {
    networker.getJsonReturns = [validResponse];

    await coinMarketCapPriceFeed.update();

    const price = coinMarketCapPriceFeed.getCurrentPrice();
    assert.equal(price.toString(), toWei(`${mockPrice}`));
  });

  it("getCurrentPrice() returns undefined if update() is never called", async function () {
    const price = coinMarketCapPriceFeed.getCurrentPrice();
    assert.equal(price, undefined);
  });

  it("getHistoricalPrice() returns the price for the specified time", async function () {
    // Run a series of updates()
    networker.getJsonReturns = [
      { data: { [symbol]: { quote: { [convert]: { price: mockPrice } } } } },
      { data: { [symbol]: { quote: { [convert]: { price: mockPrice + 1 } } } } },
      { data: { [symbol]: { quote: { [convert]: { price: mockPrice + 2 } } } } },
    ];

    const originalMockTime = mockTime;
    await coinMarketCapPriceFeed.update(); // should produce { mockTime, mockPrice }
    mockTime += 300;
    await coinMarketCapPriceFeed.update(); // should produce { mockTime + 300, mockPrice + 1 }
    mockTime += 300;
    await coinMarketCapPriceFeed.update(); // should produce {  mockTime + 600, mockPrice + 2 }

    // Do assertions for each period
    const price1 = await coinMarketCapPriceFeed.getHistoricalPrice(originalMockTime);
    assert.equal(price1.toString(), toWei(`${mockPrice}`));

    const price2 = await coinMarketCapPriceFeed.getHistoricalPrice(originalMockTime + 300);
    assert.equal(price2.toString(), toWei(`${mockPrice + 1}`));

    const price3 = await coinMarketCapPriceFeed.getHistoricalPrice(originalMockTime + 600);
    assert.equal(price3.toString(), toWei(`${mockPrice + 2}`));
  });

  it("getHistoricalPrice() throws error if update() is never called", async function () {
    const didThrow = await coinMarketCapPriceFeed.getHistoricalPrice(mockTime).catch(() => true);
    assert.isTrue(didThrow, "getHistoricalPrice() didn't throw");
  });

  it("getHistoricalPrice() returns the price if the time is within the lookout window", async function () {
    networker.getJsonReturns = [validResponse];

    await coinMarketCapPriceFeed.update();

    const price = await coinMarketCapPriceFeed.getHistoricalPrice(mockTime - lookback);
    assert.equal(price.toString(), toWei(`${mockPrice}`));
  });

  it("getHistoricalPrice() throws error if the time is before the lookout window", async function () {
    networker.getJsonReturns = [validResponse];

    await coinMarketCapPriceFeed.update();

    const didThrow = await coinMarketCapPriceFeed.getHistoricalPrice(mockTime - lookback - 1).catch(() => true);
    assert.isTrue(didThrow, "getHistoricalPrice() didn't throw");
  });

  it("getHistoricalPrice() throws error if the time is after the lookout window", async function () {
    networker.getJsonReturns = [validResponse];

    await coinMarketCapPriceFeed.update();

    const didThrow = await coinMarketCapPriceFeed.getHistoricalPrice(mockTime + 1).catch(() => true);
    assert.isTrue(didThrow, "getHistoricalPrice() didn't throw");
  });

  it("getLastUpdateTime() returns the time when update() was last called", async function () {
    networker.getJsonReturns = [validResponse];

    await coinMarketCapPriceFeed.update();

    assert.equal(coinMarketCapPriceFeed.getLastUpdateTime(), mockTime);
  });

  it("getLastUpdateTime() returns undefined if update() is never called", async function () {
    assert.equal(coinMarketCapPriceFeed.getLastUpdateTime(), undefined);
  });

  it("getPriceFeedDecimals() returns the correct value", async function () {
    assert.equal(coinMarketCapPriceFeed.getPriceFeedDecimals(), priceFeedDecimals);
  });

  it("getLookback() returns the correct value", async function () {
    assert.equal(coinMarketCapPriceFeed.getLookback(), lookback);
  });

  it("Handles bad API response properly", async function () {
    networker.getJsonReturns = [{ status: { error_message: "dummy error" } }];

    const errorCatched = await coinMarketCapPriceFeed.update().catch(() => true);
    assert.isTrue(errorCatched, "Update didn't throw");

    const price = coinMarketCapPriceFeed.getCurrentPrice();
    assert.equal(price, undefined);

    const didThrow = await coinMarketCapPriceFeed.getHistoricalPrice(mockTime).catch(() => true);
    assert.isTrue(didThrow, "getHistoricalPrice() didn't throw");
  });

  it("Should not call API again if succeeding update() call is within minTimeBetweenUpdates", async function () {
    networker.getJsonReturns = [
      { data: { [symbol]: { quote: { [convert]: { price: mockPrice } } } } },
      { data: { [symbol]: { quote: { [convert]: { price: mockPrice + 1 } } } } },
    ];

    await coinMarketCapPriceFeed.update();

    const originalMockTime = mockTime;
    mockTime += minTimeBetweenUpdates - 1;
    await coinMarketCapPriceFeed.update();

    // Last update time should remain to be originalMockTime
    const time = coinMarketCapPriceFeed.getLastUpdateTime();
    assert.equal(time, originalMockTime);

    // Current price should remain to be mockPrice
    const price = coinMarketCapPriceFeed.getCurrentPrice();
    assert.equal(price.toString(), toWei(`${mockPrice}`));
  });

  it("Has support for inverted price", async function () {
    // Inverted CMC price feed setup
    networker = new NetworkerMock();
    mockTime = new Date().getTime();

    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    const cmcInvertedPriceFeed = new CoinMarketCapPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      symbol,
      convert,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      true,
      priceFeedDecimals
    );

    // Here comes the actual tests
    networker.getJsonReturns = [validResponse];

    await cmcInvertedPriceFeed.update();

    const invertedPrice = toBN(toWei("1"))
      .mul(toBN(toWei("1")))
      .div(toBN(toWei(`${mockPrice}`)))
      .toString();

    const price = cmcInvertedPriceFeed.getCurrentPrice();
    assert.equal(price.toString(), invertedPrice);

    const historicalPrice = await cmcInvertedPriceFeed.getHistoricalPrice(mockTime);
    assert.equal(historicalPrice.toString(), invertedPrice);
  });

  it("Can handle non-18 decimal place precision", async function () {
    // non-18 decimal price feed setup
    const expectedPrice = 48.216239;
    const expectedResponse = { data: { [symbol]: { quote: { [convert]: { price: expectedPrice } } } } };

    networker = new NetworkerMock();
    mockTime = new Date().getTime();

    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    const cgSixDecimalPriceFeed = new CoinMarketCapPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      symbol,
      convert,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      6 // e.g. USDC
    );

    // Here comes the actual tests
    networker.getJsonReturns = [expectedResponse];

    await cgSixDecimalPriceFeed.update();

    const sixDecimalPrice = Convert(6)(expectedPrice);

    const price = cgSixDecimalPriceFeed.getCurrentPrice();
    assert.equal(price.toString(), sixDecimalPrice);

    const historicalPrice = await cgSixDecimalPriceFeed.getHistoricalPrice(mockTime);
    assert.equal(historicalPrice.toString(), sixDecimalPrice);
  });

  it("Produces correct url if apiKey is present", async function () {
    networker.getJsonReturns = [validResponse];
    await coinMarketCapPriceFeed.update();

    assert.deepStrictEqual(networker.getJsonInputs, [
      `https://pro-api.coinmarketcap.com/v1/cryptocurrency/quotes/latest?symbol=${symbol}&convert=${convert}&CMC_PRO_API_KEY=${apiKey}`,
    ]);
  });
});
