const winston = require("winston");
const lodash = require("lodash");

const { BalancerPriceFeed } = require("../../src/price-feed/BalancerPriceFeed");
const {
  mineTransactionsAtTime,
  advanceBlockAndSetTime,
  MAX_SAFE_JS_INT,
  stopMining,
  startMining
} = require("@uma/common");
const { delay } = require("../../src/helpers/delay.js");

const BalancerMock = artifacts.require("BalancerMock");
const Balancer = artifacts.require("Balancer");

contract("BalancerPriceFeed.js", async function(accounts) {
  const owner = accounts[0];

  let balancerMock;
  let balancerPriceFeed;
  let dummyLogger;

  let startTime, endTime;
  let premine = 5;
  let blockTime = 15;
  let lookback = premine * blockTime;

  before(async function() {
    startTime = (await web3.eth.getBlock("latest")).timestamp + blockTime * 100;
    balancerMock = await BalancerMock.new({ from: owner });
    for (i of lodash.times(premine)) {
      endTime = startTime + blockTime * i;
      // we are artificially setting price to block mined index
      const tx = await balancerMock.contract.methods.setPrice(i);
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
    assert.equal(balancerPriceFeed.getCurrentPrice(), (premine - 1).toString());
    assert.equal(balancerPriceFeed.getLastUpdateTime(), endTime);
  });
  it("historical price", async function() {
    // going to try all block times from start to end and times in between
    for (let time = startTime; time <= endTime; time += blockTime / 2) {
      const price = Math.floor((time - startTime) / blockTime);
      assert.equal(balancerPriceFeed.getHistoricalPrice(time), price);
    }
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
