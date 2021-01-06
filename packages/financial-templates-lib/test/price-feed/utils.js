const { PriceHistory, BlockHistory, computeTWAP } = require("../../src/price-feed/utils");
const { toBN } = web3.utils;

// Moved this into same file to see if there are issues with 2 tests files mining blocks
contract("Price Feed Utils", async function() {
  let blockHistory, priceHistory;
  const blockCount = 10;

  async function getPrice(number) {
    return number;
  }
  // assumiung block number and block times are the same here
  async function getBlock(number) {
    number = number === undefined ? blockCount : number;
    return {
      timestamp: number,
      number
    };
  }

  before(async function() {
    blockHistory = BlockHistory(getBlock);
    priceHistory = PriceHistory(getPrice);
    await blockHistory.update(blockCount, blockCount);
  });
  describe("BlockHistory", function() {
    it("listBlocks", async function() {
      // Should list all blocks from 0 to 10, 11 entries
      assert.equal(blockHistory.listBlocks().length, blockCount + 1);
    });

    it("getClosestBefore Exact", function() {
      const time = Math.floor(blockCount / 2);
      const block = blockHistory.getClosestBefore(time);
      assert.isOk(block);
      assert.isOk(blockHistory.has(block.number));
      assert.equal(block.timestamp, time);
    });
    it("getClosestBefore slightly off", function() {
      const time = Math.floor(blockCount / 2) + 0.5;
      const block = blockHistory.getClosestBefore(time);
      assert.isOk(block);
      assert.isOk(blockHistory.has(block.number));
      // this should return the next block lower than the timestamp
      assert.equal(block.timestamp, Math.floor(time));
    });
    it("getClosestAfter Exact", function() {
      const time = Math.floor(blockCount / 2);
      const block = blockHistory.getClosestAfter(time);
      assert.isOk(block);
      assert.isOk(blockHistory.has(block.number));
      assert.equal(block.timestamp, time);
    });
    it("getClosestAfter slightly off", function() {
      const time = Math.floor(blockCount / 2) + 0.5;
      const block = blockHistory.getClosestAfter(time);
      assert.isOk(block);
      assert.isOk(blockHistory.has(block.number));
      // this should return the next block higher than the timestamp
      assert.equal(block.timestamp, Math.ceil(time));
    });
  });
  describe("PriceHistory", function() {
    it("priceHistory.update", async function() {
      const block = blockHistory.getClosestBefore(5);
      const result = await priceHistory.update(block);
      assert.equal(result, await getPrice(block.number));
    });
    it("priceHistory.currentPrice", async function() {
      await Promise.all(blockHistory.listBlocks().map(priceHistory.update));
      const result = priceHistory.currentPrice();
      // latest price will equal latest block number
      assert.equal(result, await getPrice(blockHistory.latest().number));
    });
    it("priceHistory.getBetween", async function() {
      await Promise.all(blockHistory.listBlocks().map(priceHistory.update));
      const result = priceHistory.getBetween(0, blockCount);
      assert.equal(result.length, blockCount + 1);
    });
    it("get price by timestamp", async function() {
      await Promise.all(blockHistory.listBlocks().map(priceHistory.update));
      const block = blockHistory.getClosestBefore(blockCount / 2);
      const result = priceHistory.get(block.timestamp);
      assert.equal(result, await getPrice(block.number));
    });
  });
  describe("computeTWAP", function() {
    it("earliest price event timestamp > endTime", async function() {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [3, toBN("1")]
        ],
        1, // start time
        2, // end time
        toBN("0")
      );
      assert.equal(twap, null);
    });
    it("latest price event timestamp < startTime", async function() {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [2, toBN("2")],
          [3, toBN("3")]
        ],
        4, // start time
        5, // end time
        toBN("0")
      );
      // Expect that the TWAP is just the most recent price, since that was the price throughout the current window.
      assert.equal(twap.toString(), "3");
    });
    it("time sum is 0", async function() {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [3, toBN("1")]
        ],
        3, // start time
        3, // end time
        toBN("0")
      );
      assert.equal(twap, null);
    });
    it("One price TWAP", async function() {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [3, toBN("1")]
        ],
        1, // start time
        4, // end time
        toBN("0")
      );
      assert.equal(twap.toString(), "1");
    });
    it("Zero price TWAP", async function() {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          []
        ],
        1, // start time
        4, // end time
        toBN("0")
      );
      assert.equal(twap, null);
    });
    it("Multi price TWAP", async function() {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [2, toBN("2")],
          [3, toBN("4")]
        ],
        1, // start time
        4, // end time
        toBN("0")
      );
      // TWAP should be (2 * 1 second + 4 * 1 second) = 6 / 2 second window length = 3
      assert.equal(twap.toString(), "3");
    });
  });
});
