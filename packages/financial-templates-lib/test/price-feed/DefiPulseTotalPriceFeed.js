const { parseFixed } = require("@uma/common");
const { DefiPulseTotalPriceFeed } = require("../../src/price-feed/DefiPulseTotalPriceFeed");
const { NetworkerMock } = require("../../src/price-feed/NetworkerMock");
const winston = require("winston");

contract("DefiPulseTotalPriceFeed.js", function() {
  let defiPulseTotalPriceFeed;
  let mockTime = 1611583300;
  let networker;

  const apiKey = "test-api-key";
  const lookback = 3600 * 24 * 7;
  const decimals = 6;

  const getTime = () => mockTime;
  const minTimeBetweenUpdates = 600; // every 10 minutes

  // Fake data to inject.
  const validResponses = [
    [
      { timestamp: "1611572400", tvlUSD: 24780000000 },
      { timestamp: "1611576000", tvlUSD: 23500000000 },
      { timestamp: "1611579600", tvlUSD: 22250000000 },
      { timestamp: "1611583200", tvlUSD: 25100000001 }
    ]
  ];

  beforeEach(async function() {
    networker = new NetworkerMock();
    const dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });

    defiPulseTotalPriceFeed = new DefiPulseTotalPriceFeed(
      dummyLogger,
      web3,
      apiKey,
      lookback,
      networker,
      getTime,
      minTimeBetweenUpdates,
      decimals // Add arbitrary decimal conversion and prove this works.
    );
  });

  it("No update", async function() {
    assert.equal(defiPulseTotalPriceFeed.getCurrentPrice(), undefined);
    assert.isTrue(await defiPulseTotalPriceFeed.getHistoricalPrice(1000).catch(() => true));
    assert.equal(defiPulseTotalPriceFeed.getLastUpdateTime(), undefined);
  });

  it("Check decimals", async function() {
    assert.equal(defiPulseTotalPriceFeed.getPriceFeedDecimals(), decimals);
  });

  it("Basic historical price", async function() {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await defiPulseTotalPriceFeed.update();

    // Before period 1 should return null.
    assert.isTrue(await defiPulseTotalPriceFeed.getHistoricalPrice(1611572399).catch(() => true));
    assert.equal(
      (await defiPulseTotalPriceFeed.getHistoricalPrice(1611575900)).toString(),
      parseFixed("24.78", decimals).toString()
    );
    assert.equal(
      (await defiPulseTotalPriceFeed.getHistoricalPrice(1611579500)).toString(),
      parseFixed("23.50", decimals).toString()
    );
    assert.equal(
      (await defiPulseTotalPriceFeed.getHistoricalPrice(1611579500)).toString(),
      parseFixed("23.50", decimals).toString()
    );
    assert.equal(
      (await defiPulseTotalPriceFeed.getHistoricalPrice(1611579601)).toString(),
      parseFixed("22.25", decimals).toString()
    );
  });

  it("Basic current price", async function() {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await defiPulseTotalPriceFeed.update();

    // Should return the current price in the data.
    assert.equal(defiPulseTotalPriceFeed.getCurrentPrice().toString(), parseFixed("25.1", decimals).toString());
  });

  it("Last update time", async function() {
    // Inject data.
    networker.getJsonReturns = [...validResponses];

    await defiPulseTotalPriceFeed.update();

    // Should return the mock time.
    assert.equal(defiPulseTotalPriceFeed.getLastUpdateTime(), mockTime);
  });
});
