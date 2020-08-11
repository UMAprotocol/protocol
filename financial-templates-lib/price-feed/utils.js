const lodash = require("lodash");
const assert = require("assert");

// Downloads blocks and caches them for certain time into the past.
// Allows some in memory searches to go from timestamp to block number.
exports.BlockHistory = (web3, blocks = []) => {
  assert(web3, "requires web3");

  // Check if we have downloaded a block by number
  function has(number) {
    return blocks.find(block => block.number === number);
  }

  // Used internally, but will insert a block into cache sorted by timestamp
  function insert(block) {
    const index = lodash.sortedIndexBy(blocks, block, "timestamp");
    blocks.splice(index, 0, block);
    return blocks;
  }

  // Get the block with the closest match to timestamp
  function getClosestTime(timestamp) {
    // const index = lodash.sortedIndexBy(blocks,{timestamp},'timestamp')
    const index = lodash.sortedIndexBy(blocks, { timestamp }, x => {
      return x.timestamp;
    });
    return blocks[index];
  }

  // Call to update cache with blocks between sometime in the past from a block number
  // Block number is optional, if not specified will default to latest block number.
  async function fetchBetween(endTime, blockNumber) {
    blockNumber = blockNumber || (await web3.eth.getBlockNumber());
    if (has(blockNumber)) return fetchBetween(endTime, blockNumber - 1);
    const block = await web3.eth.getBlock(blockNumber);
    assert(block, "Provider returned empty block");
    if (block.timestamp < endTime) return blocks;
    insert(block);
    return fetchBetween(endTime, blockNumber - 1);
  }

  // Main call to update cache, will take care of fetching all blocks, caching and pruning cache.
  async function update(age, now, startBlock) {
    assert(age, "requires age in seconds");
    assert(now, "requires current time");
    const endTime = now - age;
    blocks = pruneByTimestamp(age);
    const result = fetchBetween(endTime, startBlock);
    return result;
  }

  // Removes blocks from cache which are older than age
  function pruneByTimestamp(age) {
    return blocks.filter(block => block.timestamp > seconds);
  }

  // Return all blocks in cache
  function listBlocks() {
    return blocks;
  }
  return {
    has,
    insert,
    getClosestTime,
    fetchBetween,
    update,
    pruneByTimestamp,
    listBlocks
  };
};

// Given a price function which uses block numbers, to get price,
// this creates a cache of prices to allow you to search by block timestamp
// This data does not get pruned since its extremely minimal, just [timestamp]:price
exports.PriceHistory = (getPrice, prices = {}) => {
  assert(getPrice, "requires getPrice(blockNumber) function");

  // Get the latest known price from currenty block
  function currentPrice() {
    const result = list().reduce((result, [timestamp, price]) => {
      if (result.price == null) return { timestamp, price };
      if (result.timestamp < timestamp) return { timestamp, price };
      return result;
    }, {});
    assert(result.price, "No latest price found");
    return result.price;
  }

  // Get a price at a timestamp. Timestamp must be exact. Use in conjunction with blockHistory.
  function get(timestamp) {
    assert(timestamp, "requires timestamp in seconds");
    assert(prices[timestamp], "no price for that timestamp, use block timestamp");
    return prices[timestamp];
  }

  // Get prices between two timestamps. End time defaults to now.
  function getBetween(start, end = Date.now()) {
    assert(start < end, "Start time must be less than end time");
    return Object.keys(prices)
      .filter(timestamp => timestamp <= end && timestamp >= start)
      .map(key => prices[key]);
  }

  // Check if price exists at a timestamp
  function has(timestamp) {
    return !!prices[timestamp];
  }

  // Update all prices based on known blocks.
  async function update(blocks = []) {
    for (let block of blocks) {
      if (has(block)) continue;
      prices[block.timestamp] = await getPrice(block.number);
    }
  }

  // List all prices in format [ [ timestamp, price] ]
  function list() {
    return [...Object.entries(prices)];
  }

  return {
    currentPrice,
    getBetween,
    has,
    get,
    update,
    list
  };
};
