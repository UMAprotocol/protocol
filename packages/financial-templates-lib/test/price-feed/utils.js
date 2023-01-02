const Web3 = require("web3");
const { assert } = require("chai");
const { PriceHistory, BlockHistory, computeTWAP, BlockFinder } = require("../../dist/price-feed/utils");
const { averageBlockTimeSeconds } = require("@uma/common");
const { toBN } = Web3.utils;

// Moved this into same file to see if there are issues with 2 tests files mining blocks
describe("Price Feed Utils", async function () {
  let blockHistory, priceHistory;
  const blockCount = 10;
  const lookback = 7200;

  async function getPrice(number) {
    return number;
  }
  // assumiung block number and block times are the same here
  async function getBlock(number) {
    number = number === undefined ? blockCount : number;
    return { timestamp: number, number };
  }

  before(async function () {
    blockHistory = BlockHistory(getBlock);
    priceHistory = PriceHistory(getPrice);
    await blockHistory.update(lookback, blockCount);
  });
  describe("BlockHistory", function () {
    it("listBlocks", async function () {
      // Should list all blocks from 0 to 10, 11 entries
      assert.equal(blockHistory.listBlocks().length, blockCount + 1);
    });

    it("getClosestBefore Exact", function () {
      const time = Math.floor(blockCount / 2);
      const block = blockHistory.getClosestBefore(time);
      assert.isOk(block);
      assert.isOk(blockHistory.has(block.number));
      assert.equal(block.timestamp, time);
    });
    it("getClosestBefore slightly off", function () {
      const time = Math.floor(blockCount / 2) + 0.5;
      const block = blockHistory.getClosestBefore(time);
      assert.isOk(block);
      assert.isOk(blockHistory.has(block.number));
      // this should return the next block lower than the timestamp
      assert.equal(block.timestamp, Math.floor(time));
    });
    it("getClosestAfter Exact", function () {
      const time = Math.floor(blockCount / 2);
      const block = blockHistory.getClosestAfter(time);
      assert.isOk(block);
      assert.isOk(blockHistory.has(block.number));
      assert.equal(block.timestamp, time);
    });
    it("getClosestAfter slightly off", function () {
      const time = Math.floor(blockCount / 2) + 0.5;
      const block = blockHistory.getClosestAfter(time);
      assert.isOk(block);
      assert.isOk(blockHistory.has(block.number));
      // this should return the next block higher than the timestamp
      assert.equal(block.timestamp, Math.ceil(time));
    });
  });
  describe("PriceHistory", function () {
    it("priceHistory.update", async function () {
      const block = blockHistory.getClosestBefore(5);
      const result = await priceHistory.update(block);
      assert.equal(result, await getPrice(block.number));
    });
    it("priceHistory.currentPrice", async function () {
      await Promise.all(blockHistory.listBlocks().map(priceHistory.update));
      const result = priceHistory.currentPrice();
      // latest price will equal latest block number
      assert.equal(result, await getPrice(blockHistory.latest().number));
    });
    it("priceHistory.getBetween", async function () {
      await Promise.all(blockHistory.listBlocks().map(priceHistory.update));
      const result = priceHistory.getBetween(0, blockCount);
      assert.equal(result.length, blockCount + 1);
    });
    it("get price by timestamp", async function () {
      await Promise.all(blockHistory.listBlocks().map(priceHistory.update));
      const block = blockHistory.getClosestBefore(blockCount / 2);
      const result = priceHistory.get(block.timestamp);
      assert.equal(result, await getPrice(block.number));
    });
  });

  describe("BlockFinder", function () {
    let latestBlockNumber = 1000;
    const checkBlockNumber = (blockNumber) => {
      assert.isAtMost(blockNumber, latestBlockNumber);
      assert.isAtLeast(blockNumber, 0);
    };

    const generateCases = (min, max, numCases = 100) => {
      const cases = [];
      for (let i = 0; i < numCases; i++) cases.push(Math.round(Math.random() * (max - min) + min));
      cases.push(min, max); // Ensure first and last blocks are tested.
      return cases;
    };

    it("Bounds checking", async function () {
      // Function just maps blocks 1:1 to timestamps for easy timestamp computation.
      const getBlock = async (blockNumber) => {
        if (blockNumber === "latest") blockNumber = latestBlockNumber;
        // No bounds checking in this function since we _want_ the block finder to respect the latest block.
        return { number: blockNumber, timestamp: blockNumber };
      };

      const blockFinder = new BlockFinder(getBlock);

      // Ensure that a timestamp _after_ the last block fails.
      assert.equal((await blockFinder.getBlockForTimestamp(latestBlockNumber + 1)).number, latestBlockNumber);

      // Timestamp before the first block should fail.
      assert.isTrue(await blockFinder.getBlockForTimestamp(-1).catch(() => true));
    });

    it("Timestamp collisions", async function () {
      // Get block just generates timestamps by dividing them by 10 and ceiling them, causing them to collide.
      // This essentially simulats a 10 TPS chain.
      const getBlock = async (blockNumber) => {
        if (blockNumber === "latest") blockNumber = latestBlockNumber;
        checkBlockNumber(blockNumber);
        return { number: blockNumber, timestamp: Math.ceil(blockNumber / 10) };
      };

      const blockFinder = new BlockFinder(getBlock);

      // Last timestamp is just the last block number / 10.
      const cases = generateCases(1, Math.ceil(latestBlockNumber / 10), 1000);

      // Tests each case by ensuring the floored sqrt of the timestamp matches the block number.
      await Promise.all(
        cases.map((timestamp) =>
          blockFinder
            .getBlockForTimestamp(timestamp)
            .then((block) => assert.equal(Math.ceil(block.number / 10), timestamp))
        )
      );
    });

    it("Squared timestamps", async function () {
      // Get block just generates timestamps by squaring the block number.
      const getBlock = async (blockNumber) => {
        if (blockNumber === "latest") blockNumber = latestBlockNumber;
        checkBlockNumber(blockNumber);
        return { number: blockNumber, timestamp: blockNumber ** 2 };
      };

      const blockFinder = new BlockFinder(getBlock);

      // Last timestamp is just the last block number squared.
      const cases = generateCases(0, latestBlockNumber ** 2);

      // Tests each case by ensuring the floored sqrt of the timestamp matches the block number.
      await Promise.all(
        cases.map((timestamp) =>
          blockFinder
            .getBlockForTimestamp(timestamp)
            .then((block) => assert.equal(block.number, Math.floor(Math.sqrt(timestamp))))
        )
      );
    });

    it("Random timestamps", async function () {
      // Generate random blocks.
      let lastTimestamp = 0;
      const blocks = [];
      const averageTimeBetweenBlocks = await averageBlockTimeSeconds();
      for (let i = 0; i < latestBlockNumber + 1; i++) {
        // Time is between 1 second and averageTimeBetweenBlocks * 2 + 1 seconds after the last block.
        const block = { number: i, timestamp: lastTimestamp + 1 + Math.random() * averageTimeBetweenBlocks * 2 };
        blocks.push(block);
        lastTimestamp = block.timestamp;
      }

      const getBlock = (blockNumber) => {
        if (blockNumber === "latest") blockNumber = latestBlockNumber;
        checkBlockNumber(blockNumber);
        return blocks.find((block) => block.number === blockNumber);
      };

      const blockFinder = new BlockFinder(getBlock);

      // Last timestamp is just the last block number squared.
      const cases = generateCases(blocks[0].timestamp, blocks[blocks.length - 1].timestamp);

      // Tests each case by ensuring that we find the same block in the array that the blockfinder found.
      await Promise.all(
        cases.map((timestamp) =>
          blockFinder.getBlockForTimestamp(timestamp).then((block) => {
            const expectedBlock = blocks
              .slice()
              .reverse()
              .find((testBlock) => testBlock.timestamp <= timestamp);
            assert.equal(block.number, expectedBlock.number);
          })
        )
      );
    });
  });

  describe("computeTWAP", function () {
    it("earliest price event timestamp > endTime", async function () {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [3, toBN("1")],
        ],
        1, // start time
        2, // end time
        toBN("0")
      );
      assert.equal(twap, null);
    });
    it("latest price event timestamp < startTime", async function () {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [2, toBN("2")],
          [3, toBN("3")],
        ],
        4, // start time
        5, // end time
        toBN("0")
      );
      // Expect that the TWAP is just the most recent price, since that was the price throughout the current window.
      assert.equal(twap.toString(), "3");
    });
    it("time sum is 0", async function () {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [3, toBN("1")],
        ],
        3, // start time
        3, // end time
        toBN("0")
      );
      assert.equal(twap, null);
    });
    it("One price TWAP", async function () {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [3, toBN("1")],
        ],
        1, // start time
        4, // end time
        toBN("0")
      );
      assert.equal(twap.toString(), "1");
    });
    it("Zero price TWAP", async function () {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [],
        ],
        1, // start time
        4, // end time
        toBN("0")
      );
      assert.equal(twap, null);
    });
    it("Multi price TWAP", async function () {
      const twap = computeTWAP(
        [
          // [timestamp, price]
          [2, toBN("2")],
          [3, toBN("4")],
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
