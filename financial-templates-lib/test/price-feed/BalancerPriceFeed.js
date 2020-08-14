const winston = require("winston");
const lodash = require("lodash");

const { BalancerPriceFeed } = require("../../price-feed/BalancerPriceFeed");
const {
  mineTransactionsAtTime,
  advanceBlockAndSetTime,
  MAX_SAFE_JS_INT,
  stopMining,
  startMining
} = require("@umaprotocol/common");
const { delay } = require("../../helpers/delay.js");

const BalancerMock = artifacts.require("BalancerMock");
const Balancer = artifacts.require("Balancer");

contract("balancer price feed", async function(accounts) {
  describe("BalancerPriceFeed.js", function() {
    const owner = accounts[0];

    let balancerMock;
    let balancerPriceFeed;
    let dummyLogger;

    let startTime, endTime;
    let premine = 5;
    let blockTime = 15;
    let lookback = premine * blockTime;

    before(async function() {
      startTime = (await web3.eth.getBlock("latest")).timestamp + blockTime * 10;
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
      // get first block, price should be 0
      assert.equal(balancerPriceFeed.getHistoricalPrice(startTime), "0");
      assert.equal(balancerPriceFeed.getHistoricalPrice(startTime + blockTime), "1");
    });
  });
});
