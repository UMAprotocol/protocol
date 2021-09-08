const { web3 } = require("hardhat");
const { assert } = require("chai");
const { DominationFinancePriceFeed } = require("../../dist/price-feed/DominationFinancePriceFeed");
const { NetworkerMock } = require("../../dist/price-feed/NetworkerMock");
const winston = require("winston");

describe("DominationFinancePriceFeed.js", function () {
  let priceFeed;
  let invertedPriceFeed;
  let mockTime = 1588376548;
  let networker;

  const pair = "test-pair";
  const lookback = 120; // 2 minutes.
  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 60;

  const { toBN, toWei } = web3.utils;

  // Fake data to inject.
  //
  const earliestTick = 1588376400;

  const historicalResponse = {
    status: "success",
    data: {
      rows: [
        [earliestTick + 0 * 60, "1.1"],
        [earliestTick + 1 * 60, "1.2"],
        [earliestTick + 2 * 60, "1.3"],
      ],
    },
  };

  const priceResponse = { status: "success", timestamp: 1588376583, price: "1.5" };

  const validResponses = [priceResponse, historicalResponse];

  beforeEach(async function () {
    networker = new NetworkerMock();
    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });
    priceFeed = new DominationFinancePriceFeed(
      dummyLogger,
      web3,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      false,
      18 // Prove that this will not break existing functionality
    );
    invertedPriceFeed = new DominationFinancePriceFeed(
      dummyLogger,
      web3,
      pair,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      true,
      10 // Add arbitrary decimal conversion and prove this works.
    );
  });

  it("Inverted current price", async function () {
    networker.getJsonReturns = [...validResponses];
    await invertedPriceFeed.update();

    assert.equal(
      // Should be equal to: toWei(1/1.5)
      invertedPriceFeed.getCurrentPrice().toString(),
      toBN(toWei("1"))
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("1.5")))
        // we need this last division to convert final result to correct decimals
        // in this case its from 18 decimals to 10 decimals.
        // You will see this in the rest of the inverted tests.
        .div(toBN("10").pow(toBN(18 - 10)))
        .toString()
    );
  });

  it("Inverted historical price", async function () {
    networker.getJsonReturns = [...validResponses];
    await invertedPriceFeed.update();

    // Before period 1 should return fail.
    assert.equal(earliestTick, historicalResponse.data.rows[0][0]);
    assert.isTrue(await invertedPriceFeed.getHistoricalPrice(earliestTick - 15).catch(() => true));

    // During period 1.
    assert.equal(
      // Should be equal to: toWei(1/1.1)
      (await invertedPriceFeed.getHistoricalPrice(earliestTick)).toString(),
      toBN(toWei("1"))
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("1.1")))
        .div(toBN("10").pow(toBN(18 - 10)))
        .toString()
    );

    // During period 2.
    assert.equal(
      // Should be equal to: toWei(1/1.2)
      (await invertedPriceFeed.getHistoricalPrice(historicalResponse.data.rows[1][0] + 5)).toString(),
      toBN(toWei("1"))
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("1.2")))
        .div(toBN("10").pow(toBN(18 - 10)))
        .toString()
    );

    // During period 3.
    assert.equal(
      // Should be equal to: toWei(1/1.3)
      (await invertedPriceFeed.getHistoricalPrice(historicalResponse.data.rows[2][0] + 5)).toString(),
      toBN(toWei("1"))
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("1.3")))
        .div(toBN("10").pow(toBN(18 - 10)))
        .toString()
    );

    // After period 3 should return the most recent price.
    assert.equal(
      // Should be equal to: toWei(1/1.5)
      await invertedPriceFeed.getHistoricalPrice(historicalResponse.data.rows[2][0] + 95),
      toBN(toWei("1"))
        .mul(toBN(toWei("1")))
        .div(toBN(toWei("1.5")))
        .div(toBN("10").pow(toBN(18 - 10)))
        .toString()
    );
  });

  it("No update", async function () {
    assert.equal(priceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await priceFeed.getHistoricalPrice(1000).catch(() => true));
    assert.equal(priceFeed.getLastUpdateTime(), undefined);
    assert.equal(priceFeed.getLookback(), lookback);
  });

  it("Basic historical price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await priceFeed.update();

    // Before period 1 should fail.
    assert.equal(earliestTick, historicalResponse.data.rows[0][0]);
    assert.isTrue(await priceFeed.getHistoricalPrice(earliestTick - 15).catch(() => true));

    // During period 1.
    assert.equal((await priceFeed.getHistoricalPrice(historicalResponse.data.rows[0][0] + 5)).toString(), toWei("1.1"));

    // During period 2.
    assert.equal((await priceFeed.getHistoricalPrice(historicalResponse.data.rows[1][0] + 5)).toString(), toWei("1.2"));

    // During period 3.
    assert.equal((await priceFeed.getHistoricalPrice(historicalResponse.data.rows[2][0] + 5)).toString(), toWei("1.3"));

    // After period 3 should return the most recent price.
    assert.equal(
      (await priceFeed.getHistoricalPrice(historicalResponse.data.rows[2][0] + 90)).toString(),
      toWei("1.5")
    );
  });

  it("Basic current price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await priceFeed.update();

    // Should return the current price in the data.
    assert.equal(priceFeed.getCurrentPrice().toString(), toWei("1.5"));
  });

  it("Last update time", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await priceFeed.update();

    // Should return the mock time.
    assert.equal(priceFeed.getLastUpdateTime(), mockTime);
  });

  it("No or bad response", async function () {
    // Bad price response.
    networker.getJsonReturns = [
      {
        status: "success",
        data: {
          rows: [], // Valid response, just no data points.
        },
      },
      { status: "error" },
    ];

    // Update should throw errors in both cases.
    assert.isTrue(await priceFeed.update().catch(() => true), "Update didn't throw");
    assert.isTrue(await invertedPriceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(priceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await priceFeed.getHistoricalPrice(earliestTick).catch(() => true));
    assert.equal(invertedPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await invertedPriceFeed.getHistoricalPrice(earliestTick).catch(() => true));

    // Bad historical ohlc response.
    networker.getJsonReturns = [{ status: "error" }, { status: "success", price: "64.21" }];

    assert.isTrue(await priceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(priceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await priceFeed.getHistoricalPrice(earliestTick).catch(() => true));

    // Inverted price feed returns undefined for prices equal to 0 since it cannot divide by 0
    networker.getJsonReturns = [{ status: "error" }, { status: "success", price: "0.00" }];

    assert.isTrue(await invertedPriceFeed.update().catch(() => true), "Update didn't throw");

    assert.equal(invertedPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await invertedPriceFeed.getHistoricalPrice(earliestTick).catch(() => true));
  });

  it("Update frequency", async function () {
    networker.getJsonReturns = [...validResponses];

    await priceFeed.update();

    networker.getJsonReturns = [...validResponses];

    // Update the return price to ensure it new data doesn't show up in the output.
    networker.getJsonReturns[0].price = "1.4";

    const originalMockTime = mockTime;
    mockTime += minTimeBetweenUpdates - 1;

    await priceFeed.update();
    assert.equal(priceFeed.getLastUpdateTime(), originalMockTime);
    assert.equal(priceFeed.getCurrentPrice().toString(), toWei("1.5"));
  });
});
