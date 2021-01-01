const winston = require("winston");
const lodash = require("lodash");

const { BalancerPriceFeed } = require("../../src/price-feed/BalancerPriceFeed");
const { mineTransactionsAtTime } = require("@uma/common");
const { getTruffleContract } = require("@uma/core");

const CONTRACT_VERSION = "latest";

const BalancerMock = getTruffleContract("BalancerMock", web3, CONTRACT_VERSION);
const Balancer = getTruffleContract("Balancer", web3, CONTRACT_VERSION);

contract("BalancerPriceFeed.js", async function(accounts) {
  const owner = accounts[0];

  let balancerMock;
  let balancerPriceFeed;
  let scaleUpBalancerPriceFeed;
  let scaleDownBalancerPriceFeed;
  let dummyLogger;

  let startTime, endTime;
  let premine = 5;
  let blockTime = 15;
  let lookback = premine * blockTime;

  before(async function() {
    startTime = (await web3.eth.getBlock("latest")).timestamp + blockTime * 100;
    balancerMock = await BalancerMock.new({ from: owner });
    for (let i of lodash.times(premine)) {
      endTime = startTime + blockTime * i;
      // we are artificially setting price to block mined index
      const tx = await balancerMock.contract.methods.setPrice(i * 10 ** 6);
      await mineTransactionsAtTime(web3, [tx], endTime, accounts[0]);
    }

    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });

    balancerPriceFeed = new BalancerPriceFeed(
      dummyLogger,
      web3,
      () => endTime,
      Balancer.abi,
      balancerMock.address,
      // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
      accounts[1],
      accounts[2],
      lookback
    );
    await balancerPriceFeed.update();
  });

  it("Basic current price", async function() {
    // last price is basically the last premine block index
    assert.equal(balancerPriceFeed.getCurrentPrice().toString(), ((premine - 1) * 10 ** 6).toString());
    assert.equal(balancerPriceFeed.getLastUpdateTime(), endTime);
  });
  it("historical price", async function() {
    // going to try all block times from start to end and times in between.
    for (let time = startTime; time <= endTime; time += blockTime) {
      const price = Math.floor((time - startTime) / blockTime);
      assert.equal(balancerPriceFeed.getHistoricalPrice(time).toString(), price * 10 ** 6);
    }
  });
  describe("Balancer pool returns a non 18 decimal pool price", function() {
    before(async function() {
      // Here we specify that pool is returning a 6 decimal precision price, so the BalancerPriceFeed
      // should scale up the price by 12 decimal points.
      balancerPriceFeed = new BalancerPriceFeed(
        dummyLogger,
        web3,
        () => endTime,
        Balancer.abi,
        balancerMock.address,
        // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
        accounts[1],
        accounts[2],
        lookback,
        6
      );
      await balancerPriceFeed.update();
    });
    it("Current price", async function() {
      assert.equal(balancerPriceFeed.getCurrentPrice().toString(), ((premine - 1) * 10 ** 18).toString());
    });
    it("Historical prices", async function() {
      for (let time = startTime; time <= endTime; time += blockTime) {
        const price = Math.floor((time - startTime) / blockTime);
        assert.equal(balancerPriceFeed.getHistoricalPrice(time).toString(), price * 10 ** 18);
      }
    });
  });
  describe("Can return non-18 precision prices", function() {
    before(async function() {
      // Here we specify that pool is returning a 6 decimal precision price, and we want prices in
      // 12 decimals.
      scaleUpBalancerPriceFeed = new BalancerPriceFeed(
        dummyLogger,
        web3,
        () => endTime,
        Balancer.abi,
        balancerMock.address,
        // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
        accounts[1],
        accounts[2],
        lookback,
        6,
        12
      );
      // Here we specify that pool is returning a 6 decimal precision price, and we want prices in
      // 4 decimals.
      scaleDownBalancerPriceFeed = new BalancerPriceFeed(
        dummyLogger,
        web3,
        () => endTime,
        Balancer.abi,
        balancerMock.address,
        // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
        accounts[1],
        accounts[2],
        lookback,
        6,
        4
      );
      await scaleUpBalancerPriceFeed.update();
      await scaleDownBalancerPriceFeed.update();
    });
    it("Current price", async function() {
      assert.equal(scaleUpBalancerPriceFeed.getCurrentPrice().toString(), ((premine - 1) * 10 ** 12).toString());
      assert.equal(scaleDownBalancerPriceFeed.getCurrentPrice().toString(), ((premine - 1) * 10 ** 4).toString());
    });
    it("Historical prices", async function() {
      for (let time = startTime; time <= endTime; time += blockTime) {
        const price = Math.floor((time - startTime) / blockTime);
        assert.equal(scaleUpBalancerPriceFeed.getHistoricalPrice(time).toString(), price * 10 ** 12);
        assert.equal(scaleDownBalancerPriceFeed.getHistoricalPrice(time).toString(), price * 10 ** 4);
      }
    });
  });
  it("update", async function() {
    // should not throw
    await balancerPriceFeed.update();
  });
  it("test 0 lookback", async function() {
    let balancerPriceFeed = new BalancerPriceFeed(
      dummyLogger,
      web3,
      () => endTime,
      Balancer.abi,
      balancerMock.address,
      // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
      accounts[1],
      accounts[2],
      0
    );
    // should not crash
    await balancerPriceFeed.update();
    const result = balancerPriceFeed.getCurrentPrice();
    // see that a price exists.
    assert.exists(result);
  });
});
