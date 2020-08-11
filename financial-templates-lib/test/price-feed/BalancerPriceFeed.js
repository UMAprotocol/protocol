const { toWei, toBN } = web3.utils;
const winston = require("winston");
const lodash = require("lodash");

const { PriceHistory, BlockHistory } = require("../../price-feed/utils");
const { BalancerPriceFeed } = require("../../price-feed/BalancerPriceFeed");
const { mineTransactionsAtTime, advanceBlockAndSetTime, MAX_SAFE_JS_INT } = require("@umaprotocol/common");
const { delay } = require("../../helpers/delay.js");

const BalancerMock = artifacts.require("BalancerMock");
const Balancer = artifacts.require("Balancer");

contract("balancer price feed", async function(accounts) {
  // Moved this into same file to see if there are issues with 2 tests files mining blocks
  describe("Price Feed Utils", function() {
    let blockHistory, priceHistory;
    let startTime, endTime;
    let premine = 5;
    let blocktime = 15;
    let age = premine * blocktime;

    async function getPrice(number) {
      return number;
    }

    before(async function() {
      blockHistory = BlockHistory(web3);
      priceHistory = PriceHistory(getPrice);
      startTime = (await web3.eth.getBlock("latest")).timestamp + blocktime;
      for (i of lodash.times(premine)) {
        endTime = startTime + blocktime * i;
        await advanceBlockAndSetTime(web3, endTime);
      }
      await blockHistory.update(age, endTime);
    });

    it("listBlocks", async function() {
      assert.isAbove(blockHistory.listBlocks().length, 0);
    });
    it("getClosestTime", function() {
      const time = endTime - Math.floor(age / 2);
      const block = blockHistory.getClosestTime(time);
      assert.isOk(block);
      assert.isOk(blockHistory.has(block.number));
      assert.isAtLeast(block.timestamp, time);
    });
    it("priceHistory.update", async function() {
      await priceHistory.update(blockHistory.listBlocks());
    });
    it("priceHistory.currentPrice", async function() {
      await priceHistory.update(blockHistory.listBlocks());
      const result = priceHistory.currentPrice();
      assert.isOk(result);
    });
    it("priceHistory.getBetween", async function() {
      await priceHistory.update(blockHistory.listBlocks());
      const result = priceHistory.getBetween(endTime - age, endTime);
      assert.isOk(result);
      assert.isOk(result.length);
    });
    it("get price by timestamp", async function() {
      await priceHistory.update(blockHistory.listBlocks());
      const block = blockHistory.getClosestTime(startTime);
      const result = priceHistory.get(block.timestamp);
      assert.equal(result, await getPrice(block.number));
    });
  });
  describe("BalancerPriceFeed.js", function() {
    const owner = accounts[0];

    let balancerMock;
    let balancerPriceFeed;
    let dummyLogger;

    let startTime, endTime;
    let premine = 5;
    let blocktime = 15;
    let lookback = premine * blocktime;

    before(async function() {
      startTime = (await web3.eth.getBlock("latest")).timestamp + blocktime;
      balancerMock = await BalancerMock.new({ from: owner });
      for (i of lodash.times(premine)) {
        endTime = startTime + blocktime * i;
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
    });
  });
});
