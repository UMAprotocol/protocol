const { web3 } = require("hardhat");
const { assert } = require("chai");
const { parseFixed } = require("@uma/common");
const { DefiPulsePriceFeed } = require("../../dist/price-feed/DefiPulsePriceFeed");
const { NetworkerMock } = require("../../dist/price-feed/NetworkerMock");
const winston = require("winston");

describe("DefiPulsePriceFeed.js", function () {
  let defiPulsePriceFeed;
  let mockTime = 1611583300;
  let networker;

  const defipulseApiKey = "test-api-key";
  const lookback = 3600 * 24 * 7;
  const decimals = 6;
  const project = "SushiSwap";

  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 600; // every 10 minutes

  // Fake data to inject.
  const validResponses = [
    [
      { timestamp: "1611572400", tvlUSD: 24780000000 },
      { timestamp: "1611576000", tvlUSD: 23500000000 },
      { timestamp: "1611579600", tvlUSD: 22250000000 },
      { timestamp: "1611583200", tvlUSD: 25100000001 },
    ],
  ];

  beforeEach(async function () {
    networker = new NetworkerMock();
    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    defiPulsePriceFeed = new DefiPulsePriceFeed(
      dummyLogger,
      web3,
      defipulseApiKey,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      decimals, // Add arbitrary decimal conversion and prove this works.
      project
    );
  });

  it("No update", async function () {
    assert.equal(defiPulsePriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await defiPulsePriceFeed.getHistoricalPrice(1000).catch(() => true));
    assert.equal(defiPulsePriceFeed.getLastUpdateTime(), undefined);
  });

  it("Check decimals", async function () {
    assert.equal(defiPulsePriceFeed.getPriceFeedDecimals(), decimals);
  });

  it("Basic historical price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await defiPulsePriceFeed.update();

    // Before period 1 should return null.
    assert.isTrue(await defiPulsePriceFeed.getHistoricalPrice(1611572399).catch(() => true));
    assert.equal(
      (await defiPulsePriceFeed.getHistoricalPrice(1611575900)).toString(),
      parseFixed("24.78", decimals).toString()
    );
    assert.equal(
      (await defiPulsePriceFeed.getHistoricalPrice(1611579500)).toString(),
      parseFixed("23.50", decimals).toString()
    );
    assert.equal(
      (await defiPulsePriceFeed.getHistoricalPrice(1611579500)).toString(),
      parseFixed("23.50", decimals).toString()
    );
    assert.equal(
      (await defiPulsePriceFeed.getHistoricalPrice(1611579601)).toString(),
      parseFixed("22.25", decimals).toString()
    );
  });

  it("Basic current price", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await defiPulsePriceFeed.update();

    // Should return the current price in the data.
    assert.equal(defiPulsePriceFeed.getCurrentPrice().toString(), parseFixed("25.1", decimals).toString());
  });

  it("Last update time", async function () {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await defiPulsePriceFeed.update();

    // Should return the mock time.
    assert.equal(defiPulsePriceFeed.getLastUpdateTime(), mockTime);
  });

  it("Bad project name", async function () {
    const dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    let errorThrown = false;
    try {
      new DefiPulsePriceFeed(
        dummyLogger,
        web3,
        defipulseApiKey,
        lookback,
        networker,
        getTime,
        minTimeBetweenUpdates,
        decimals, // Add arbitrary decimal conversion and prove this works.
        "NotAProject"
      );
    } catch (error) {
      errorThrown = true;
    }
    assert.isTrue(errorThrown);
  });
});
