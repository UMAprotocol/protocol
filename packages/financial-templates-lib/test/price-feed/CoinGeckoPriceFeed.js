const { web3 } = require("hardhat");
const { assert } = require("chai");

const { CoinGeckoPriceFeed } = require("../../dist/price-feed/CoinGeckoPriceFeed");
const { NetworkerMock } = require("../../dist/price-feed/NetworkerMock");
const winston = require("winston");
const { parseFixed } = require("@uma/common");

const Convert = (decimals) => (number) => parseFixed(number.toString().substring(0, decimals), decimals).toString();

describe("CoinGeckoPriceFeed.js", function () {
  let coinGeckoPriceFeed;
  let networker;
  let mockTime;

  const contractAddress = "0x6b175474e89094c44da98b954eedeac495271d0f";
  const currency = "php";
  const lookback = 120; // 2 minutes.
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 60;
  const priceFeedDecimals = 18;

  const { toWei, toBN } = web3.utils;

  const mockPrice = 48.15;
  const validResponse = { [contractAddress]: { [currency]: mockPrice } };

  beforeEach(async function () {
    networker = new NetworkerMock();
    mockTime = new Date().getTime();

    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    coinGeckoPriceFeed = new CoinGeckoPriceFeed(
      dummyLogger,
      web3,
      contractAddress,
      currency,
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

    await coinGeckoPriceFeed.update();

    const price = coinGeckoPriceFeed.getCurrentPrice();
    assert.equal(price.toString(), toWei(`${mockPrice}`));
  });

  it("getCurrentPrice() returns undefined if update() is never called", async function () {
    const price = coinGeckoPriceFeed.getCurrentPrice();
    assert.equal(price, undefined);
  });

  it("getHistoricalPrice() returns the price for the specified time", async function () {
    // Run a series of updates()
    networker.getJsonReturns = [
      { [contractAddress]: { [currency]: mockPrice } },
      { [contractAddress]: { [currency]: mockPrice + 1 } },
      { [contractAddress]: { [currency]: mockPrice + 2 } },
    ];

    const originalMockTime = mockTime;
    await coinGeckoPriceFeed.update(); // should produce { mockTime, mockPrice }
    mockTime += 300;
    await coinGeckoPriceFeed.update(); // should produce { mockTime + 300, mockPrice + 1 }
    mockTime += 300;
    await coinGeckoPriceFeed.update(); // should produce {  mockTime + 600, mockPrice + 2 }

    // Do assertions for each period
    const price1 = await coinGeckoPriceFeed.getHistoricalPrice(originalMockTime);
    assert.equal(price1.toString(), toWei(`${mockPrice}`));

    const price2 = await coinGeckoPriceFeed.getHistoricalPrice(originalMockTime + 300);
    assert.equal(price2.toString(), toWei(`${mockPrice + 1}`));

    const price3 = await coinGeckoPriceFeed.getHistoricalPrice(originalMockTime + 600);
    assert.equal(price3.toString(), toWei(`${mockPrice + 2}`));
  });

  it("getHistoricalPrice() throws error if update() is never called", async function () {
    const didThrow = await coinGeckoPriceFeed.getHistoricalPrice(mockTime).catch(() => true);
    assert.isTrue(didThrow, "getHistoricalPrice() didn't throw");
  });

  it("getHistoricalPrice() returns the price if the time is within the lookout window", async function () {
    networker.getJsonReturns = [validResponse];

    await coinGeckoPriceFeed.update();

    const price = await coinGeckoPriceFeed.getHistoricalPrice(mockTime - lookback);
    assert.equal(price.toString(), toWei(`${mockPrice}`));
  });

  it("getHistoricalPrice() throws error if the time is before the lookout window", async function () {
    networker.getJsonReturns = [validResponse];

    await coinGeckoPriceFeed.update();

    const didThrow = await coinGeckoPriceFeed.getHistoricalPrice(mockTime - lookback - 1).catch(() => true);
    assert.isTrue(didThrow, "getHistoricalPrice() didn't throw");
  });

  it("getHistoricalPrice() throws error if the time is after the lookout window", async function () {
    networker.getJsonReturns = [validResponse];

    await coinGeckoPriceFeed.update();

    const didThrow = await coinGeckoPriceFeed.getHistoricalPrice(mockTime + 1).catch(() => true);
    assert.isTrue(didThrow, "getHistoricalPrice() didn't throw");
  });

  it("getLastUpdateTime() returns the time when update() was last called", async function () {
    networker.getJsonReturns = [validResponse];

    await coinGeckoPriceFeed.update();

    assert.equal(coinGeckoPriceFeed.getLastUpdateTime(), mockTime);
  });

  it("getLastUpdateTime() returns undefined if update() is never called", async function () {
    assert.equal(coinGeckoPriceFeed.getLastUpdateTime(), undefined);
  });

  it("getPriceFeedDecimals() returns the correct value", async function () {
    assert.equal(coinGeckoPriceFeed.getPriceFeedDecimals(), priceFeedDecimals);
  });

  it("getLookback() returns the correct value", async function () {
    assert.equal(coinGeckoPriceFeed.getLookback(), lookback);
  });

  it("Handles bad API response properly", async function () {
    networker.getJsonReturns = [{}];

    const errorCatched = await coinGeckoPriceFeed.update().catch(() => true);
    assert.isTrue(errorCatched, "Update didn't throw");

    const price = coinGeckoPriceFeed.getCurrentPrice();
    assert.equal(price, undefined);

    const didThrow = await coinGeckoPriceFeed.getHistoricalPrice(mockTime).catch(() => true);
    assert.isTrue(didThrow, "getHistoricalPrice() didn't throw");
  });

  it("Should not call API again if succeeding update() call is within minTimeBetweenUpdates", async function () {
    networker.getJsonReturns = [
      { [contractAddress]: { [currency]: mockPrice } },
      { [contractAddress]: { [currency]: mockPrice + 1 } },
    ];

    await coinGeckoPriceFeed.update();

    const originalMockTime = mockTime;
    mockTime += minTimeBetweenUpdates - 1;
    await coinGeckoPriceFeed.update();

    // Last update time should remain to be originalMockTime
    const time = coinGeckoPriceFeed.getLastUpdateTime();
    assert.equal(time, originalMockTime);

    // Current price should remain to be mockPrice
    const price = coinGeckoPriceFeed.getCurrentPrice();
    assert.equal(price.toString(), toWei(`${mockPrice}`));
  });

  it("Has support for inverted price", async function () {
    // Inverted CMC price feed setup
    networker = new NetworkerMock();
    mockTime = new Date().getTime();

    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    const cgInvertedPriceFeed = new CoinGeckoPriceFeed(
      dummyLogger,
      web3,
      contractAddress,
      currency,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      true,
      priceFeedDecimals
    );

    // Here comes the actual tests
    networker.getJsonReturns = [validResponse];

    await cgInvertedPriceFeed.update();

    const invertedPrice = toBN(toWei("1"))
      .mul(toBN(toWei("1")))
      .div(toBN(toWei(`${mockPrice}`)))
      .toString();

    const price = cgInvertedPriceFeed.getCurrentPrice();
    assert.equal(price.toString(), invertedPrice);

    const historicalPrice = await cgInvertedPriceFeed.getHistoricalPrice(mockTime);
    assert.equal(historicalPrice.toString(), invertedPrice);
  });

  it("Can handle non-18 decimal place precision", async function () {
    // non-18 decimal price feed setup
    const expectedPrice = 48.158716;
    const expectedResponse = { [contractAddress]: { [currency]: expectedPrice } };

    networker = new NetworkerMock();
    mockTime = new Date().getTime();

    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    const cgSixDecimalPriceFeed = new CoinGeckoPriceFeed(
      dummyLogger,
      web3,
      contractAddress,
      currency,
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

  it("Produces correct url", async function () {
    networker.getJsonReturns = [validResponse];
    await coinGeckoPriceFeed.update();

    assert.deepStrictEqual(networker.getJsonInputs, [
      `https://api.coingecko.com/api/v3/simple/token_price/ethereum?contract_addresses=${contractAddress}&vs_currencies=${currency}`,
    ]);
  });
});
