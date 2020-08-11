const { toWei, toBN } = web3.utils;
const winston = require("winston");
const lodash = require("lodash");

const { BalancerPriceFeed } = require("../../price-feed/BalancerPriceFeed");
const { mineTransactionsAtTime, MAX_SAFE_JS_INT } = require("@umaprotocol/common");
const { delay } = require("../../helpers/delay.js");

const BalancerMock = artifacts.require("BalancerMock");
const Balancer = artifacts.require("Balancer");

contract("BalancerPriceFeed.js", function(accounts) {
  const owner = accounts[0];

  let balancerMock;
  let balancerPriceFeed;
  let dummyLogger;

  let now = Math.floor(Date.now() / 1000);
  let premine = 5;
  let blocktime = 15;
  let lookback = premine * blocktime;

  before(async function() {
    balancerMock = await BalancerMock.new({ from: owner });
    for (i of lodash.times(premine)) {
      const ts = Math.floor(now - blocktime * (premine - i));
      // we are artificially setting price to block mined index
      const tx = await balancerMock.contract.methods.setPrice(i);
      await mineTransactionsAtTime(web3, [tx], ts, accounts[0]);
    }

    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });

    balancerPriceFeed = new BalancerPriceFeed(
      dummyLogger,
      web3,
      () => now,
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
    assert.equal(balancerPriceFeed.getLastUpdateTime(), now);
  });
  it("historical price", async function() {
    // get first block, price should be 0
    const pastTime = now - premine * blocktime;
    assert.equal(balancerPriceFeed.getHistoricalPrice(pastTime), "0");
  });
});
