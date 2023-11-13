const { web3, getContract, network } = require("hardhat");
const { assert } = require("chai");
const { toWei, toBN } = web3.utils;
const winston = require("winston");

const { BalancerPriceFeed } = require("../../dist/price-feed/BalancerPriceFeed");
const { mineTransactionsAtTimeHardhat, MAX_SAFE_JS_INT } = require("@uma/common");
const { delay } = require("@uma/logger");

const BalancerMock = getContract("BalancerMock");
const Balancer = getContract("Balancer");

// This is needed to get a timestamp sufficiently in the future that mining blocks a few hours before this will not
// cause any block timestamp ordering issues. Note: this sort of block mining is used often in this test.
const getFutureTimestamp = async () => {
  return Number((await web3.eth.getBlock("latest")).timestamp) + 10000;
};

describe("BalancerPriceFeed.js", function () {
  let owner, accounts;

  let dexMock;
  let dexPriceFeed;
  let mockTime = 0;
  let dummyLogger;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner] = accounts;
  });

  beforeEach(async function () {
    dexMock = await BalancerMock.new({ from: owner }).send({ from: owner });

    // The BalancerPriceFeed does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    dexPriceFeed = new BalancerPriceFeed(
      dummyLogger,
      web3,
      () => mockTime,
      Balancer.abi,
      dexMock.options.address,
      // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
      accounts[1],
      accounts[2],
      3600,
      3600
    );
  });

  it("Basic current price", async function () {
    await dexMock.methods.setPrice(toWei("0.5")).send({ from: owner });
    await dexPriceFeed.update();

    assert.equal(dexPriceFeed.getSpotPrice().toString(), toWei("0.5"));
    assert.equal(dexPriceFeed.getLastUpdateTime(), mockTime);
    assert.equal(dexPriceFeed.getLookback(), 3600);
  });

  it("Correctly selects most recent price", async function () {
    await dexMock.methods.setPrice(toWei("1")).send({ from: owner });
    await dexMock.methods.setPrice(toWei("0.5")).send({ from: owner });
    await dexMock.methods.setPrice(toWei("0.25")).send({ from: owner });
    // Add an invalid price as the most recent price, which should be ignored.
    await dexMock.methods.setPrice(toWei("0")).send({ from: owner });
    await dexPriceFeed.update();

    assert.equal(dexPriceFeed.getSpotPrice().toString(), toWei("0.25"));
  });

  it("Selects most recent price in same block", async function () {
    // Get a far future timestamp to not interfere with any existing blocks.
    const time = await getFutureTimestamp();

    const transactions = [
      dexMock.methods.setPrice(toWei("1")),
      dexMock.methods.setPrice(toWei("0.5")),
      dexMock.methods.setPrice(toWei("0.25")),
    ];

    // Ensure all are included in the same block
    const [receipt1, receipt2, receipt3] = await mineTransactionsAtTimeHardhat(network, transactions, time, owner);
    assert.equal(receipt2.blockNumber, receipt1.blockNumber);
    assert.equal(receipt3.blockNumber, receipt1.blockNumber);

    // Update the PF and ensure the price it gives is the last price in the block.
    await dexPriceFeed.update();
    assert.equal(dexPriceFeed.getSpotPrice().toString(), toWei("0.25"));
  });

  it("No price or only invalid prices", async function () {
    await dexPriceFeed.update();

    assert.equal(dexPriceFeed.getSpotPrice(), null);
    assert.equal(dexPriceFeed.getCurrentPrice(), null);

    await dexMock.methods.setPrice(toWei("0")).send({ from: owner });
    assert.equal(dexPriceFeed.getSpotPrice(), null);
    assert.equal(dexPriceFeed.getCurrentPrice(), null);
  });

  // Basic test to verify TWAP (non simulated time).
  it("Basic 2-price TWAP", async function () {
    // Update the prices with a small amount of time between.
    const result1 = await dexMock.methods.setPrice(toWei("1")).send({ from: owner });
    await delay(1);
    // Invalid price should be ignored.
    await dexMock.methods.setPrice(toWei("0")).send({ from: owner });
    const result2 = await dexMock.methods.setPrice(toWei("0.5")).send({ from: owner });

    const getBlockTime = async (result) => {
      return (await web3.eth.getBlock(result.blockNumber)).timestamp;
    };

    // Grab the exact blocktimes.
    const time1 = await getBlockTime(result1);
    const time2 = await getBlockTime(result2);
    mockTime = time2 + 1;

    // Allow the library to compute the TWAP.
    await dexPriceFeed.update();

    const totalTime = mockTime - time1;
    const weightedPrice1 = toBN(toWei("1")).muln(time2 - time1);
    const weightedPrice2 = toBN(toWei("0.5")); // 0.5 * 1 second since the mockTime is one second past time2.

    // Compare the TWAPs.
    assert.equal(
      dexPriceFeed.getCurrentPrice().toString(),
      weightedPrice1.add(weightedPrice2).divn(totalTime).toString()
    );
  });

  it("All events before window", async function () {
    await dexMock.methods.setPrice(toWei("1")).send({ from: owner });
    await dexMock.methods.setPrice(toWei("0.5")).send({ from: owner });
    await dexMock.methods.setPrice(toWei("0.25")).send({ from: owner });

    // Set the mock time to very far in the future.
    mockTime = MAX_SAFE_JS_INT;

    await dexPriceFeed.update();

    // Expect that the TWAP is just the most recent price, since that was the price throughout the current window.
    assert.equal(dexPriceFeed.getCurrentPrice().toString(), toWei("0.25"));
  });

  it("All events after window", async function () {
    await dexMock.methods.setPrice(toWei("1")).send({ from: owner });
    await dexMock.methods.setPrice(toWei("0.5")).send({ from: owner });
    await dexMock.methods.setPrice(toWei("0.25")).send({ from: owner });

    // Set the mock time to very far in the past.
    mockTime = 5000;

    await dexPriceFeed.update();

    // Since all the events are past our window, there is no valid price, and the TWAP should return null.
    assert.equal(dexPriceFeed.getCurrentPrice(), null);
  });

  it("One event within window, several before", async function () {
    // Get a far future timestamp to not interfere with any existing blocks.
    const currentTime = await getFutureTimestamp();

    // Set prices before the T-3600 window; only the most recent one should be counted.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("4"))], currentTime - 7300, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("2"))], currentTime - 7200, owner);

    // Set a price within the T-3600 window
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("1"))], currentTime - 1800, owner);

    // Prices after the TWAP window should be ignored.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("8"))], currentTime + 1, owner);

    mockTime = currentTime;
    await dexPriceFeed.update();

    // The TWAP price should be the TWAP of the last price before the TWAP window and the single price
    // within the window:
    // - latest price before TWAP window: 2
    // - single price exactly 50% through the window: 1
    // - TWAP: 2 * 0.5 + 1 * 0.5 = 1.5
    assert.equal(dexPriceFeed.getCurrentPrice(), toWei("1.5"));
  });

  it("Basic historical TWAP", async function () {
    // Get a far future timestamp to not interfere with any existing blocks.
    const currentTime = await getFutureTimestamp();

    // Historical window starts 2 hours ago. Set the price to 100 before the beginning of the window (2.5 hours before currentTime)
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("100"))], currentTime - 7200, owner);

    // At an hour and a half ago, set the price to 90.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("90"))], currentTime - 5400, owner);

    // At an hour and a half ago - 1 second, set the price to an invalid one. This should be ignored.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("0"))], currentTime - 5399, owner);

    // At an hour ago, set the price to 80.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("80"))], currentTime - 3600, owner);

    // At half an hour ago, set the price to 70.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("70"))], currentTime - 1800, owner);

    mockTime = currentTime;

    await dexPriceFeed.update();

    // The historical TWAP for 1 hour ago (the earliest allowed query) should be 100 for the first half and then 90 for the second half -> 95.
    assert.equal((await dexPriceFeed.getHistoricalPrice(currentTime - 3600)).toString(), toWei("95"));

    // The historical TWAP for 45 mins ago should be 100 for the first quarter, 90 for the middle half, and 80 for the last quarter -> 90.
    assert.equal((await dexPriceFeed.getHistoricalPrice(currentTime - 2700)).toString(), toWei("90"));

    // The historical TWAP for 30 minutes ago should be 90 for the first half and then 80 for the second half -> 85.
    assert.equal((await dexPriceFeed.getHistoricalPrice(currentTime - 1800)).toString(), toWei("85"));

    // The historical TWAP for 15 minutes ago should be 90 for the first quarter, 80 for the middle half, and 70 for the last quarter -> 80.
    assert.equal((await dexPriceFeed.getHistoricalPrice(currentTime - 900)).toString(), toWei("80"));

    // The historical TWAP for now should be 80 for the first half and then 70 for the second half -> 75.
    assert.equal((await dexPriceFeed.getHistoricalPrice(currentTime)).toString(), toWei("75"));
  });

  it("Historical time earlier than TWAP window", async function () {
    const currentTime = await getFutureTimestamp();
    mockTime = currentTime;

    // Set a price within the TWAP window so that if the historical time requested were within
    // the window, then there wouldn't be an error.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("1"))], currentTime - 3600, owner);
    await dexPriceFeed.update();

    // The TWAP lookback is 1 hour (3600 seconds). The price feed should return null if we attempt to go any further back than that.
    assert.equal(await dexPriceFeed.getHistoricalPrice(currentTime - 3599), toWei("1"));
    assert.isTrue(await dexPriceFeed.getHistoricalPrice(currentTime - 3601).catch(() => true));
  });
  it("TWAP length of 0 returns non-TWAP'd current and historical prices", async function () {
    dexPriceFeed = new BalancerPriceFeed(
      dummyLogger,
      web3,
      () => mockTime,
      Balancer.abi,
      dexMock.options.address,
      // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
      accounts[1],
      accounts[2],
      3600,
      0
    );

    // Get a far future timestamp to not interfere with any existing blocks.
    const currentTime = await getFutureTimestamp();

    // Same test scenario as the Basic Historical TWAP test to illustrate what setting twapLength to 0 does.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("100"))], currentTime - 7200, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("90"))], currentTime - 5400, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("80"))], currentTime - 3600, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("70"))], currentTime - 1800, owner);

    mockTime = currentTime;

    await dexPriceFeed.update();

    // Historical prices should be equal to latest price at timestamp
    assert.equal((await dexPriceFeed.getHistoricalPrice(currentTime - 3600)).toString(), toWei("80"));
    assert.equal((await dexPriceFeed.getHistoricalPrice(currentTime - 1800)).toString(), toWei("70"));
    assert.equal(dexPriceFeed.getCurrentPrice().toString(), toWei("70"));
    assert.equal(dexPriceFeed.getSpotPrice().toString(), toWei("70"));
  });
  it("Lookback of 0 returns only current price", async function () {
    dexPriceFeed = new BalancerPriceFeed(
      dummyLogger,
      web3,
      () => mockTime,
      Balancer.abi,
      dexMock.options.address,
      // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
      accounts[1],
      accounts[2],
      0,
      3600
    );

    // Get a far future timestamp to not interfere with any existing blocks.
    const currentTime = await getFutureTimestamp();

    // Same test scenario as the Basic Historical TWAP test to illustrate what setting twapLength to 0 does.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("100"))], currentTime - 7200, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("90"))], currentTime - 5400, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("80"))], currentTime - 3600, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("70"))], currentTime - 1800, owner);

    mockTime = currentTime;

    await dexPriceFeed.update();

    // Historical prices should be equal to latest price at timestamp
    assert.isTrue(await dexPriceFeed.getHistoricalPrice(currentTime - 3600).catch(() => true));
    assert.isTrue(await dexPriceFeed.getHistoricalPrice(currentTime - 2700).catch(() => true));
    assert.isTrue(await dexPriceFeed.getHistoricalPrice(currentTime - 1800).catch(() => true));
    assert.isTrue(await dexPriceFeed.getHistoricalPrice(currentTime - 900).catch(() => true));
    assert.equal(dexPriceFeed.getCurrentPrice().toString(), toWei("70"));
    assert.equal(dexPriceFeed.getSpotPrice().toString(), toWei("70"));
  });
  it("Setting both lookback and twap to 0 should update without crashing and only return current price", async function () {
    dexPriceFeed = new BalancerPriceFeed(
      dummyLogger,
      web3,
      () => mockTime,
      Balancer.abi,
      dexMock.options.address,
      // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
      accounts[1],
      accounts[2],
      0,
      0
    );

    // Get a far future timestamp to not interfere with any existing blocks.
    const currentTime = await getFutureTimestamp();

    // Same test scenario as the Basic Historical TWAP test to illustrate what setting twapLength to 0 does.
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("100"))], currentTime - 7200, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("90"))], currentTime - 5400, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("80"))], currentTime - 3600, owner);
    await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("70"))], currentTime - 1800, owner);

    mockTime = currentTime;

    await dexPriceFeed.update();

    // Historical prices should be equal to latest price at timestamp
    assert.isTrue(await dexPriceFeed.getHistoricalPrice(currentTime - 3600).catch(() => true));
    assert.isTrue(await dexPriceFeed.getHistoricalPrice(currentTime - 2700).catch(() => true));
    assert.isTrue(await dexPriceFeed.getHistoricalPrice(currentTime - 1800).catch(() => true));
    assert.isTrue(await dexPriceFeed.getHistoricalPrice(currentTime - 900).catch(() => true));
    assert.equal(dexPriceFeed.getCurrentPrice().toString(), toWei("70"));
    assert.equal(dexPriceFeed.getSpotPrice().toString(), toWei("70"));
  });

  describe("Can return non-18 precision prices", function () {
    let scaleDownPriceFeed, scaleUpPriceFeed;
    beforeEach(async function () {
      // Here we specify that the balancer pool is reporting a 6 decimal precision price, and we want prices in
      // 12 decimals. This should scale up prices by 10e6.
      scaleUpPriceFeed = new BalancerPriceFeed(
        dummyLogger,
        web3,
        () => mockTime,
        Balancer.abi,
        dexMock.options.address,
        // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
        accounts[1],
        accounts[2],
        3600,
        3600,
        6,
        12
      );
      // Here we specify that the balancer pool is returning a 6 decimal precision price, and we want prices in
      // 4 decimals. This should scale down prices by 10e2.
      scaleDownPriceFeed = new BalancerPriceFeed(
        dummyLogger,
        web3,
        () => mockTime,
        Balancer.abi,
        dexMock.options.address,
        // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
        accounts[1],
        accounts[2],
        3600,
        3600,
        6,
        4
      );
    });
    it("Basic 2 price TWAP", async function () {
      // Update the prices with a small amount of time between.
      const result1 = await dexMock.methods.setPrice(toWei("1")).send({ from: owner });
      await delay(1);
      const result2 = await dexMock.methods.setPrice(toWei("0.5")).send({ from: owner });

      const getBlockTime = async (result) => {
        return (await web3.eth.getBlock(result.blockNumber)).timestamp;
      };

      // Grab the exact blocktimes.
      const time1 = await getBlockTime(result1);
      const time2 = await getBlockTime(result2);
      mockTime = time2 + 1;

      // Allow the library to compute the TWAP.
      await scaleUpPriceFeed.update();
      await scaleDownPriceFeed.update();

      const totalTime = mockTime - time1;
      const weightedPrice1 = toBN(toWei("1")).muln(time2 - time1);
      const weightedPrice2 = toBN(toWei("0.5")); // 0.5 * 1 second since the mockTime is one second past time2.

      // Compare the scaled TWAPs.
      assert.equal(
        scaleUpPriceFeed.getCurrentPrice().toString(),
        weightedPrice1
          .add(weightedPrice2)
          .divn(totalTime)
          .muln(10 ** 6) // scale UP by 10e6
          .toString()
      );
      assert.equal(
        scaleDownPriceFeed.getCurrentPrice().toString(),
        weightedPrice1
          .add(weightedPrice2)
          .divn(totalTime)
          .divn(10 ** 2) // scale DOWN by 10e2
          .toString()
      );
    });
    it("Basic historical TWAP", async function () {
      // Get a far future timestamp to not interfere with any existing blocks.
      const currentTime = await getFutureTimestamp();

      // Historical window starts 2 hours ago. Set the price to 100 before the beginning of the window (2.5 hours before currentTime)
      await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("100"))], currentTime - 7200, owner);

      // At an hour and a half ago, set the price to 90.
      await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("90"))], currentTime - 5400, owner);

      // At an hour ago, set the price to 80.
      await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("80"))], currentTime - 3600, owner);

      // At half an hour ago, set the price to 70.
      await mineTransactionsAtTimeHardhat(network, [dexMock.methods.setPrice(toWei("70"))], currentTime - 1800, owner);

      mockTime = currentTime;

      await scaleDownPriceFeed.update();
      await scaleUpPriceFeed.update();

      // The historical TWAP for 1 hour ago (the earliest allowed query) should be 100 for the first half and then 90 for the second half -> 95.
      assert.equal(
        (await scaleUpPriceFeed.getHistoricalPrice(currentTime - 3600)).toString(),
        toBN(toWei("95"))
          .muln(10 ** 6)
          .toString()
      );
      assert.equal(
        (await scaleDownPriceFeed.getHistoricalPrice(currentTime - 3600)).toString(),
        toBN(toWei("95"))
          .divn(10 ** 2)
          .toString()
      );
    });
  });
  // TODO: add the following TWAP tests using simulated block times:
  // - Some events post TWAP window, some inside window.
  // - Complex (5+ value) TWAP with events overlapping on both sides of the window.

  // TODO: add tests to ensure intra-transaction price changes are handled correctly.
});
