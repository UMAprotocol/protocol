const lodash = require("lodash");
const assert = require("assert");

// Downloads blocks and caches them for certain time into the past.
// Allows some in memory searches to go from timestamp to block number.
// Use blocks parameter to optionally insert prefilled cache of blocks.
// Block array is sorted from oldest to newest (smallest timestamp => newest timestamp)
exports.BlockHistory = (getBlock, blocks = []) => {
  assert(getBlock, "requires getBlock(number) function");

  // Check if we have downloaded a block by number
  function has(number) {
    return blocks.find(block => block.number === number);
  }

  function latest() {
    return blocks[blocks.length - 1];
  }

  // Used internally, but will insert a block into cache sorted by timestamp
  function insert(block) {
    const index = lodash.sortedIndexBy(blocks, block, "timestamp");
    blocks.splice(index, 0, block);
    return blocks;
  }

  // Gets block equal to or newer (larger) than timestamp
  function getClosestAfter(timestamp) {
    // this gaurantees you will get the index of the block you need to insert before
    // or in other words the next block older than timestamp
    const index = lodash.sortedIndexBy(blocks, { timestamp }, "timestamp");
    return blocks[index];
  }

  // Gets block equal to or older (lower) than timestamp
  function getClosestBefore(timestamp) {
    const index = lodash.sortedIndexBy(blocks, { timestamp }, "timestamp");
    // need to check for an exact match in this case, otherwise go to the older block
    if (blocks[index].timestamp === timestamp) return blocks[index];
    return blocks[index - 1];
  }

  // Call to update cache with blocks between sometime in the past from a block number
  async function fetchBetween(endTime, blockNumber) {
    if (blockNumber < 0) return blocks;
    // Block number is optional, if not specified will default to latest block number.
    const block = await getBlock(blockNumber);
    assert(block, "Provider returned empty block");
    if (block.timestamp < endTime) return blocks;
    blockNumber = block.number;
    if (has(blockNumber)) return fetchBetween(endTime, blockNumber - 1);
    insert(block);
    return fetchBetween(endTime, blockNumber - 1);
  }

  // Main call to update cache, will take care of fetching all blocks, caching and pruning cache.
  async function update(age, now, startBlock) {
    assert(age >= 0, "requires age in seconds");
    assert(now >= 0, "requires current time");
    const endTime = now - age;
    pruneByTimestamp(age);
    const result = fetchBetween(endTime, startBlock);
    return result;
  }

  // Removes blocks from cache which are older than age
  function pruneByTimestamp(age) {
    blocks = blocks.filter(block => block.timestamp > age);
  }

  // Return all blocks in cache
  function listBlocks() {
    return blocks;
  }

  return {
    // Public main API
    update,
    getClosestBefore,
    getClosestAfter,
    // Private, but can use as needed
    has,
    insert,
    fetchBetween,
    pruneByTimestamp,
    listBlocks,
    latest
  };
};

// Given a price function which uses block numbers to get price,
// this creates a cache of prices to allow you to search by block timestamp
// This data does not get pruned since its extremely minimal, just [timestamp]:price
exports.PriceHistory = (getPrice, prices = {}) => {
  assert(getPrice, "requires getPrice(blockNumber) function");

  // Get the latest known price from current block
  function currentPrice() {
    const result = list().reduce((result, [timestamp, price]) => {
      // this conversion needs to happen since timestamp will be strings for object keys
      timestamp = Number(timestamp);
      if (result.price === undefined || result.price === null) return { timestamp, price };
      if (result.timestamp < timestamp) return { timestamp, price };
      return result;
    }, {});
    return result.price;
  }

  // set price at time
  function set(timestamp, price) {
    assert(timestamp >= 0, "requires timestamp in seconds");
    prices[timestamp] = price;
    return price;
  }

  // Get a price at a timestamp. Timestamp must be exact. Use in conjunction with blockHistory.
  function get(timestamp) {
    assert(timestamp >= 0, "requires timestamp in seconds");
    assert(has(timestamp), "no price for that timestamp, use block timestamp");
    return prices[timestamp];
  }

  // Get prices between two timestamps. End time defaults to now.
  function getBetween(start, end = Date.now()) {
    assert(start <= end, "Start time must be less than end time");
    return Object.keys(prices)
      .filter(timestamp => timestamp <= end && timestamp >= start)
      .map(key => prices[key]);
  }

  // Check if price exists at a timestamp
  function has(timestamp) {
    return prices[timestamp] !== undefined;
  }

  // Update price for block unless a price exists already
  async function update(block = {}) {
    assert(block.timestamp >= 0, "requires block with timestamp");
    assert(block.number >= 0, "requires block with number");
    if (has(block.timestamp)) return get(block.timestamp);
    return set(block.timestamp, await getPrice(block.number));
  }

  // List all prices in format [ [ timestamp, price] ]
  function list() {
    return Object.entries(prices);
  }

  return {
    // Public main api
    currentPrice,
    getBetween,
    get,
    // Private but can use if needed
    has,
    set,
    update,
    list
  };
};
