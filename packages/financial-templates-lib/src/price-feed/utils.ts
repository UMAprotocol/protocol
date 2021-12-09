import lodash from "lodash";
import assert from "assert";
import { averageBlockTimeSeconds, MAX_SAFE_JS_INT } from "@uma/common";
import type { BN } from "../types";
export { BlockFinder } from "@uma/sdk";

type WithoutStringTimestamp<T extends { timestamp: number | string }> = T & { timestamp: number };

// Downloads blocks and caches them for certain time into the past.
// Allows some in memory searches to go from timestamp to block number.
// Use blocks parameter to optionally insert prefilled cache of blocks.
// Block array is sorted from oldest to newest (smallest timestamp => newest timestamp)
export const BlockHistory = <T extends { number: number; timestamp: number | string }>(
  getBlock: (number?: number) => Promise<T>,
  blocks: T[] = []
): {
  has(number: number): boolean;
  latest(): T;
  insert(block: T): T[];
  getClosestAfter(timestamp: number): T;
  getClosestBefore: (timestamp: number) => T;
  update: (lookback: number, now: number, bufferBlockPercent?: number) => Promise<T[]>;
  listBlocks(): T[];
} => {
  assert(getBlock, "requires getBlock(number) function");

  // Check if we have downloaded a block by number
  function has(number: number): boolean {
    return blocks.find((block) => block.number === number) !== undefined;
  }

  function latest(): T {
    return blocks[blocks.length - 1];
  }

  // Used internally, but will insert a block into cache sorted by timestamp
  function insert(block: T): T[] {
    const index = lodash.sortedIndexBy(blocks, block, "timestamp");
    blocks.splice(index, 0, block);
    return blocks;
  }

  // Gets block equal to or newer (larger) than timestamp
  function getClosestAfter(timestamp: number) {
    // this gaurantees you will get the index of the block you need to insert before
    // or in other words the next block older than timestamp
    const index = lodash.sortedIndexBy(blocks, { timestamp } as T, "timestamp");
    return blocks[index];
  }

  // Gets block equal to or older (lower) than timestamp
  function getClosestBefore(timestamp: number) {
    const index = lodash.sortedIndexBy(blocks, { timestamp } as T, "timestamp");
    // need to check for an exact match in this case, otherwise go to the older block
    if (blocks[index] && blocks[index].timestamp === timestamp) return blocks[index];
    return blocks[index - 1];
  }

  // Main call to update cache, will take care of fetching all blocks, caching and pruning cache.
  async function update(lookback: number, now: number, bufferBlockPercent = 1.1) {
    assert(lookback >= 0, "requires lookback in seconds");
    assert(now >= 0, "requires current time");

    // Note, we make an informed approximation about the block height that corresponds to the earliest timestamp,
    // this allows us to query all block heights from this early number to the current number in parallel, instead of
    // having to traverse backwards sequentially from the current number to this early number.
    const latestBlock = (await getBlock()) as WithoutStringTimestamp<T>;
    const latestBlockHeight = latestBlock.number;
    // Add a conservative block height buffer so that we capture all of the blocks within the lookback window,
    // and if the result is negative then set it to 0. On a test network it is possible for the `earliestBlockHeight`
    // to be negative.
    const earliestBlockHeight = Math.max(
      0,
      latestBlockHeight - Math.floor((bufferBlockPercent * lookback) / (await averageBlockTimeSeconds()))
    );

    // Push all getBlock() promises into an array to execute in parallel
    const getBlockPromises: Promise<WithoutStringTimestamp<T>>[] = [];
    for (let i = earliestBlockHeight; i <= latestBlockHeight; i++) {
      getBlockPromises.push(getBlock(i) as Promise<WithoutStringTimestamp<T>>);
    }
    const result = await Promise.all(getBlockPromises);

    // Insert all blocks into cache whose timestamp is equal to or greater than (now-lookback).
    result.map((_block) => {
      if (_block.timestamp >= now - lookback) {
        insert(_block);
      }
    });
    return result;
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
    listBlocks,
    latest,
  };
};

// Given a price function which uses block numbers to get price,
// this creates a cache of prices to allow you to search by block timestamp
// This data does not get pruned since its extremely minimal, just [timestamp]:price
export const PriceHistory = <T>(
  getPrice: (blockNumber: number) => Promise<T | null>,
  prices: { [timestamp: number]: T } = {}
): {
  currentPrice: () => T | null;
  getBetween: (start: number, end?: number) => T[];
  get: (timestamp: number) => T;
  has: (timestamp: number) => boolean;
  set: (timestamp: number, price: T) => T;
  update: (block: { timestamp: number | string; number: number }) => Promise<T | undefined>;
  list: () => [number: number, price: T][];
} => {
  assert(getPrice, "requires getPrice(blockNumber) function");

  // Get the latest known price from current block
  function currentPrice(): T | null {
    const result = list().reduce(
      (result, [timestamp, price]) => {
        if (result.price === undefined || result.price === null) return { timestamp, price };
        if (result.timestamp < timestamp) return { timestamp, price };
        return result;
      },
      { timestamp: 0, price: null as null | T }
    );
    return result.price;
  }

  // set price at time
  function set(timestamp: number, price: T) {
    assert(timestamp >= 0, "requires timestamp in seconds");
    prices[timestamp] = price;
    return price;
  }

  // Get a price at a timestamp. Timestamp must be exact. Use in conjunction with blockHistory.
  function get(timestamp: number): T {
    assert(timestamp >= 0, "requires timestamp in seconds");
    assert(has(timestamp), "no price for that timestamp, use block timestamp");
    return prices[timestamp];
  }

  // Get prices between two timestamps. End time defaults to now.
  function getBetween(start: number, end = Date.now()): T[] {
    assert(start <= end, "Start time must be less than end time");
    return Object.keys(prices)
      .map(Number)
      .filter((timestamp) => timestamp <= end && timestamp >= start)
      .map((key) => prices[key]);
  }

  // Check if price exists at a timestamp
  function has(timestamp: number): boolean {
    return prices[timestamp] !== undefined;
  }

  // Update price for block unless a price exists already
  async function update(block: { timestamp: number | string; number: number }): Promise<T | undefined> {
    assert(
      block.timestamp !== null && block.timestamp !== undefined && Number(block.timestamp) >= 0,
      "requires block with timestamp"
    );
    assert(block.number >= 0, "requires block with number");
    const timestamp = Number(block.timestamp);
    if (has(timestamp)) return get(timestamp);
    const price = await getPrice(block.number);
    if (price !== undefined && price !== null) {
      // Only add prices to history that are non-null.
      return set(timestamp, price);
    }
  }

  // List all prices in format [ [ timestamp, price] ]
  function list(): [number: number, price: T][] {
    return Object.entries(prices).map(([number, price]) => [parseInt(number), price]);
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
    list,
  };
};

type TwapEvent = [timestamp: number, price: BN | null];

// Given a list of price events in chronological order [timestamp, price] and a time window, returns the time-weighted
// average price.
export const computeTWAP = (
  events: TwapEvent[],
  startTime: number,
  endTime: number,
  startingPriceSum: BN
): BN | null => {
  // Add fake element that's far in the future to the end of the array to simplify TWAP calculation.
  events.push([MAX_SAFE_JS_INT, null]);

  let lastPrice = null;
  let lastTime = null;
  let priceSum = startingPriceSum;
  let timeSum = 0;
  for (const event of events) {
    // Because the price window goes up until the next event, computation cannot start until event 2.
    if (lastTime && lastPrice) {
      const startWindow = Math.max(lastTime, startTime);
      const endWindow = Math.min(event[0], endTime);
      const windowLength = Math.max(endWindow - startWindow, 0);
      priceSum = priceSum.add(lastPrice.muln(windowLength));
      timeSum += windowLength;
    }

    // If first event is later than end time, return null
    if (event[0] > endTime) {
      break;
    }

    // events are in the shape: [timestamp, price]
    lastPrice = event[1];
    lastTime = event[0];
  }

  if (timeSum === 0) {
    return null;
  }

  return priceSum.divn(timeSum);
};
