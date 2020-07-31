const { toWei, toBN } = web3.utils;
const winston = require("winston");

const { BalancerPriceFeed } = require("../../price-feed/BalancerPriceFeed");
const { mineTransactionsAtTime, MAX_SAFE_JS_INT } = require("@umaprotocol/common");
const { delay } = require("../../helpers/delay.js");

const BalancerMock = artifacts.require("BalancerMock");
const Balancer = artifacts.require("Balancer");

contract("BalancerPriceFeed.js", function(accounts) {
  const owner = accounts[0];

  let balancerMock;
  let balancerPriceFeed;
  let mockTime = 0;
  let dummyLogger;

  beforeEach(async function() {
    balancerMock = await BalancerMock.new({ from: owner });

    // DummyLogger will not print anything to console as only capture `info` level events.
    dummyLogger = winston.createLogger({
      level: "info",
      transports: [new winston.transports.Console()]
    });

    balancerPriceFeed = new BalancerPriceFeed(
      dummyLogger,
      web3,
      () => mockTime,
      Balancer.abi,
      balancerMock.address,
      // These dont matter in the mock, but would represent the tokenIn and tokenOut for calling price feed.
      accounts[1],
      accounts[2]
    );
  });

  it("Basic current price", async function() {
    await balancerPriceFeed.update();
    assert.equal(balancerPriceFeed.getCurrentPrice(), "0");
    assert.equal(balancerPriceFeed.getLastUpdateTime(), mockTime);
  });
});
