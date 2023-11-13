const { web3, getContract, network } = require("hardhat");
const { assert } = require("chai");
const { toWei, toBN } = web3.utils;
const winston = require("winston");

const { UniswapV2PriceFeed } = require("../../dist/price-feed/UniswapPriceFeed");
const { mineTransactionsAtTimeHardhat, MAX_SAFE_JS_INT, parseFixed } = require("@uma/common");
const { delay } = require("@uma/logger");

const UniswapMock = getContract("UniswapV2Mock");
const Uniswap = getContract("UniswapV2");
const Token = getContract("ExpandedERC20");

const Convert = (decimals) => (number) => (number ? parseFixed(number.toString(), decimals).toString() : number);

// This is needed to get a timestamp sufficiently in the future that mining blocks a few hours before this will not
// cause any block timestamp ordering issues. Note: this sort of block mining is used often in this test.
const getFutureTime = async () => Number((await web3.eth.getBlock("latest")).timestamp) + 10000;

describe("UniswapV2PriceFeed", function () {
  let owner, accounts;

  let uniswapMock;
  let uniswapPriceFeed;
  let mockTime = 0;
  let dummyLogger;

  before(async function () {
    accounts = await web3.eth.getAccounts();
    [owner] = accounts;
  });

  beforeEach(async function () {
    uniswapMock = await UniswapMock.new().send({ from: owner });

    // The UniswapPriceFeed does not emit any info `level` events.  Therefore no need to test Winston outputs.
    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({ level: "info", transports: [new winston.transports.Console()] });

    uniswapPriceFeed = new UniswapV2PriceFeed(
      dummyLogger,
      Uniswap.abi,
      Token.abi,
      web3,
      uniswapMock.options.address,
      3600,
      3600,
      () => mockTime,
      false
    );

    // By default, token0 and token1 use 18 decimal precision
    const token0 = await Token.new("Uni Token0", "U0", 18).send({ from: owner });
    const token1 = await Token.new("Uni Token1", "U1", 18).send({ from: owner });
    await uniswapMock.methods.setTokens(token0.options.address, token1.options.address).send({ from: owner });
    await uniswapPriceFeed.update();
  });

  it("Basic current price", async function () {
    await uniswapMock.methods.setPrice(toWei("2"), toWei("1")).send({ from: owner });
    await uniswapPriceFeed.update();

    assert.equal(uniswapPriceFeed.getLastBlockPrice().toString(), toWei("0.5"));
    assert.equal(uniswapPriceFeed.getLastUpdateTime(), mockTime);
    assert.equal(uniswapPriceFeed.getLookback(), 3600);
  });

  it("Correctly selects most recent price", async function () {
    await uniswapMock.methods.setPrice(toWei("1"), toWei("1")).send({ from: owner });
    await uniswapMock.methods.setPrice(toWei("2"), toWei("1")).send({ from: owner });
    await uniswapMock.methods.setPrice(toWei("4"), toWei("1")).send({ from: owner });
    // Add an invalid price as the most recent price, which should be ignored.
    await uniswapMock.methods.setPrice(toWei("0"), toWei("1")).send({ from: owner });
    await uniswapPriceFeed.update();

    assert.equal(uniswapPriceFeed.getLastBlockPrice().toString(), toWei("0.25"));
  });

  it("Selects most recent price in same block", async function () {
    // Get a far future timestamp to not interfere with any existing blocks.
    const time = await getFutureTime();

    const transactions = [
      uniswapMock.methods.setPrice(toWei("1"), toWei("1")),
      uniswapMock.methods.setPrice(toWei("2"), toWei("1")),
      uniswapMock.methods.setPrice(toWei("4"), toWei("1")),
    ];

    // Ensure all are included in the same block
    const [receipt1, receipt2, receipt3] = await mineTransactionsAtTimeHardhat(network, transactions, time, owner);
    assert.equal(receipt2.blockNumber, receipt1.blockNumber);
    assert.equal(receipt3.blockNumber, receipt1.blockNumber);

    // Update the PF and ensure the price it gives is the last price in the block.
    await uniswapPriceFeed.update();
    assert.equal(uniswapPriceFeed.getLastBlockPrice().toString(), toWei("0.25"));
  });

  it("No price or only invalid prices", async function () {
    await uniswapPriceFeed.update();

    assert.equal(uniswapPriceFeed.getLastBlockPrice(), null);
    assert.equal(uniswapPriceFeed.getCurrentPrice(), null);

    await uniswapMock.methods.setPrice(toWei("0"), toWei("1")).send({ from: owner });
    assert.equal(uniswapPriceFeed.getLastBlockPrice(), null);
    assert.equal(uniswapPriceFeed.getCurrentPrice(), null);
  });

  // Basic test to verify TWAP (non simulated time).
  it("Basic 2-price TWAP", async function () {
    // Update the prices with a small amount of time between.
    const result1 = await uniswapMock.methods.setPrice(toWei("1"), toWei("1")).send({ from: owner });
    await delay(1);
    // Invalid price should be ignored.
    await uniswapMock.methods.setPrice(toWei("0"), toWei("1")).send({ from: owner });
    const result2 = await uniswapMock.methods.setPrice(toWei("2"), toWei("1")).send({ from: owner });

    const getBlockTime = async (result) => {
      return (await web3.eth.getBlock(result.blockNumber)).timestamp;
    };

    // Grab the exact blocktimes.
    const time1 = await getBlockTime(result1);
    const time2 = await getBlockTime(result2);
    mockTime = time2 + 1;

    // Allow the library to compute the TWAP.
    await uniswapPriceFeed.update();

    const totalTime = mockTime - time1;
    const weightedPrice1 = toBN(toWei("1")).muln(time2 - time1);
    const weightedPrice2 = toBN(toWei("0.5")); // 0.5 * 1 second since the mockTime is one second past time2.

    // Compare the TWAPs.
    assert.equal(
      uniswapPriceFeed.getCurrentPrice().toString(),
      weightedPrice1.add(weightedPrice2).divn(totalTime).toString()
    );
  });

  it("All events before window", async function () {
    await uniswapMock.methods.setPrice(toWei("1"), toWei("1")).send({ from: owner });
    await uniswapMock.methods.setPrice(toWei("2"), toWei("1")).send({ from: owner });
    await uniswapMock.methods.setPrice(toWei("4"), toWei("1")).send({ from: owner });

    // Set the mock time to very far in the future.
    mockTime = MAX_SAFE_JS_INT;

    await uniswapPriceFeed.update();

    // Expect that the TWAP is just the most recent price, since that was the price throughout the current window.
    assert.equal(uniswapPriceFeed.getCurrentPrice().toString(), toWei("0.25"));
  });

  it("All events after window", async function () {
    await uniswapMock.methods.setPrice(toWei("1"), toWei("1")).send({ from: owner });
    await uniswapMock.methods.setPrice(toWei("2"), toWei("1")).send({ from: owner });
    await uniswapMock.methods.setPrice(toWei("4"), toWei("1")).send({ from: owner });

    // Set the mock time to very far in the past.
    mockTime = 5000;

    await uniswapPriceFeed.update();

    // Since all the events are past our window, there is no valid price, and the TWAP should return null.
    assert.equal(uniswapPriceFeed.getCurrentPrice(), null);
  });

  it("One event within window, several before", async function () {
    // Get a far future timestamp to not interfere with any existing blocks.
    const currentTime = await getFutureTime();

    // Set prices before the T-3600 window; only the most recent one should be counted.
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("1"), toWei("4"))],
      currentTime - 7300,
      owner
    );
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("1"), toWei("2"))],
      currentTime - 7200,
      owner
    );

    // Set a price within the T-3600 window
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("1"), toWei("1"))],
      currentTime - 1800,
      owner
    );

    // Prices after the TWAP window should be ignored.
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("1"), toWei("8"))],
      currentTime + 1,
      owner
    );

    mockTime = currentTime;
    await uniswapPriceFeed.update();

    // The TWAP price should be the TWAP of the last price before the TWAP window and the single price
    // within the window:
    // - latest price before TWAP window: 2
    // - single price exactly 50% through the window: 1
    // - TWAP: 2 * 0.5 + 1 * 0.5 = 1.5
    assert.equal(uniswapPriceFeed.getCurrentPrice(), toWei("1.5"));
  });

  it("Basic historical TWAP", async function () {
    // Get a far future timestamp to not interfere with any existing blocks.
    const currentTime = await getFutureTime();

    // Historical window starts 2 hours ago. Set the price to 100 before the beginning of the window (2.5 hours before currentTime)
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("1"), toWei("100"))],
      currentTime - 7200,
      owner
    );

    // At an hour and a half ago, set the price to 90.
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("1"), toWei("90"))],
      currentTime - 5400,
      owner
    );

    // At an hour and a half ago - 1 second, set the price to an invalid one. This should be ignored.
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("0"), toWei("1"))],
      currentTime - 5399,
      owner
    );

    // At an hour ago, set the price to 80.
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("1"), toWei("80"))],
      currentTime - 3600,
      owner
    );

    // At half an hour ago, set the price to 70.
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("1"), toWei("70"))],
      currentTime - 1800,
      owner
    );

    mockTime = currentTime;

    await uniswapPriceFeed.update();

    // The historical TWAP for 1 hour ago (the earliest allowed query) should be 100 for the first half and then 90 for the second half -> 95.
    assert.equal((await uniswapPriceFeed.getHistoricalPrice(currentTime - 3600)).toString(), toWei("95"));

    // The historical TWAP for 45 mins ago should be 100 for the first quarter, 90 for the middle half, and 80 for the last quarter -> 90.
    assert.equal((await uniswapPriceFeed.getHistoricalPrice(currentTime - 2700)).toString(), toWei("90"));

    // The historical TWAP for 30 minutes ago should be 90 for the first half and then 80 for the second half -> 85.
    assert.equal((await uniswapPriceFeed.getHistoricalPrice(currentTime - 1800)).toString(), toWei("85"));

    // The historical TWAP for 15 minutes ago should be 90 for the first quarter, 80 for the middle half, and 70 for the last quarter -> 80.
    assert.equal((await uniswapPriceFeed.getHistoricalPrice(currentTime - 900)).toString(), toWei("80"));

    // The historical TWAP for now should be 80 for the first half and then 70 for the second half -> 75.
    assert.equal((await uniswapPriceFeed.getHistoricalPrice(currentTime)).toString(), toWei("75"));
  });

  it("Historical time earlier than TWAP window", async function () {
    const currentTime = await getFutureTime();
    mockTime = currentTime;

    // Set a price within the TWAP window so that if the historical time requested were within
    // the window, then there wouldn't be an error.
    await mineTransactionsAtTimeHardhat(
      network,
      [uniswapMock.methods.setPrice(toWei("1"), toWei("1"))],
      currentTime - 3600,
      owner
    );
    await uniswapPriceFeed.update();

    // The TWAP lookback is 1 hour (3600 seconds). The price feed should throw if we attempt to go any further back than that.
    assert.equal(await uniswapPriceFeed.getHistoricalPrice(currentTime - 3599), toWei("1"));
    assert.isTrue(await uniswapPriceFeed.getHistoricalPrice(currentTime - 3601).catch(() => true));
  });

  it("Invert price", async function () {
    uniswapPriceFeed = new UniswapV2PriceFeed(
      dummyLogger,
      Uniswap.abi,
      Token.abi,
      web3,
      uniswapMock.options.address,
      3600,
      3600,
      () => mockTime,
      true
    );

    await uniswapMock.methods.setPrice(toWei("2"), toWei("1")).send({ from: owner });
    await uniswapPriceFeed.update();

    assert.equal(uniswapPriceFeed.getLastBlockPrice().toString(), toWei("2"));
  });

  describe("Can handle non-18 precision pool prices and return non-18 precision prices", function () {
    let scaleDownPriceFeed, scaleUpPriceFeed;
    let token0Precision = 8;
    let token1Precision = 6;
    const convertToken0 = Convert(token0Precision);
    const convertToken1 = Convert(token1Precision);

    beforeEach(async function () {
      // This UniswapPriceFeed's _getPriceFromSyncEvent will return prices in same precision as
      // token1. But we also change the token0 precision to test that the
      // UniswapPriceFeed correctly handles it.
      let token0 = await Token.new("Uni Token 0", "T0", token0Precision).send({ from: owner });
      let token1 = await Token.new("Uni Token 1", "T1", token1Precision).send({ from: owner });
      await uniswapMock.methods.setTokens(token0.options.address, token1.options.address).send({ from: owner });

      // Since the price is not inverted for this pricefeed, the `_getPriceFromSyncEvent()` method
      // will return prices using the same precision as token1, which is 6 for these tests.

      // Here we specify that we want to return prices from the pricefeed in
      // 12 decimals, so this should scale up prices derived from the Sync events by 10e6, from 6
      // decimals to 12 decimals.
      scaleUpPriceFeed = new UniswapV2PriceFeed(
        dummyLogger,
        Uniswap.abi,
        Token.abi,
        web3,
        uniswapMock.options.address,
        3600,
        3600,
        () => mockTime,
        false,
        12
      );

      // Here we specify that we want to return prices from the pricefeed in
      // 4 decimals, so this should scale down prices derived from the Sync events by 10e2, from 6
      // decimals to 4 decimals.
      scaleDownPriceFeed = new UniswapV2PriceFeed(
        dummyLogger,
        Uniswap.abi,
        Token.abi,
        web3,
        uniswapMock.options.address,
        3600,
        3600,
        () => mockTime,
        false,
        4
      );

      // Update for pricefeed to read UniswapMock tokens.
      await uniswapPriceFeed.update();
    });
    it("Basic 2 price TWAP", async function () {
      // Update the prices with a small amount of time between
      const result1 = await uniswapMock.methods.setPrice(convertToken0("1"), convertToken1("1")).send({ from: owner });
      await delay(1);
      const result2 = await uniswapMock.methods.setPrice(convertToken0("2"), convertToken1("1")).send({ from: owner });

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
      // Prices are returned in token1 precision since the UniswapPriceFeed is not inverted.
      const weightedPrice1 = toBN(convertToken1("1").toString()).muln(time2 - time1);
      const weightedPrice2 = toBN(convertToken1("0.5").toString()); // 0.5 * 1 second since the mockTime is one second past time2.

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
      const currentTime = await getFutureTime();

      // Historical window starts 2 hours ago. Set the price to 100 before the beginning of the window (2.5 hours before currentTime)
      await mineTransactionsAtTimeHardhat(
        network,
        [uniswapMock.methods.setPrice(convertToken0("1"), convertToken1("100"))],
        currentTime - 7200,
        owner
      );

      // At an hour and a half ago, set the price to 90.
      await mineTransactionsAtTimeHardhat(
        network,
        [uniswapMock.methods.setPrice(convertToken0("1"), convertToken1("90"))],
        currentTime - 5400,
        owner
      );

      // At an hour ago, set the price to 80.
      await mineTransactionsAtTimeHardhat(
        network,
        [uniswapMock.methods.setPrice(convertToken0("1"), convertToken1("80"))],
        currentTime - 3600,
        owner
      );

      // At half an hour ago, set the price to 70.
      await mineTransactionsAtTimeHardhat(
        network,
        [uniswapMock.methods.setPrice(convertToken0("1"), convertToken1("70"))],
        currentTime - 1800,
        owner
      );

      mockTime = currentTime;

      await scaleDownPriceFeed.update();
      await scaleUpPriceFeed.update();

      // The historical TWAP for 1 hour ago (the earliest allowed query) should be 100 for the first half and then 90 for the second half -> 95.
      assert.equal(
        (await scaleUpPriceFeed.getHistoricalPrice(currentTime - 3600)).toString(),
        toBN(convertToken1("95").toString())
          .muln(10 ** 6)
          .toString()
      );
      assert.equal(
        (await scaleDownPriceFeed.getHistoricalPrice(currentTime - 3600)).toString(),
        toBN(convertToken1("95").toString())
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
