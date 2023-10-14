import assert from "assert";
import sortedIndexBy from "lodash/sortedIndexBy";
import clamp from "lodash/clamp";
import { estimateBlocksElapsed } from "./utils";

export type WithoutStringTimestamp<T extends { timestamp: number | string }> = T & { timestamp: number };

export default class BlockFinder<T extends { number: number; timestamp: number | string }> {
  constructor(
    private readonly requestBlock: (requestedBlock: string | number) => Promise<T>,
    private readonly blocks: T[] = [],
    private readonly chainId: number = 1
  ) {
    assert(requestBlock, "requestBlock function must be provided");
  }

  /**
   * @notice Gets the latest block whose timestamp is <= the provided timestamp.
   * @param {number} timestamp timestamp to search.
   */
  public async getBlockForTimestamp(timestamp: number | string): Promise<T> {
    timestamp = Number(timestamp);
    assert(timestamp !== undefined && timestamp !== null, "timestamp must be provided");
    // If the last block we have stored is too early, grab the latest block.
    if (this.blocks.length === 0 || this.blocks[this.blocks.length - 1].timestamp < timestamp) {
      const block = await this.getLatestBlock();
      if (timestamp >= block.timestamp) return block;
    }

    // Check the first block. If it's greater than our timestamp, we need to find an earlier block.
    if (this.blocks[0].timestamp > timestamp) {
      const initialBlock = this.blocks[0] as WithoutStringTimestamp<T>;
      // We use a 2x cushion to reduce the number of iterations in the following loop and increase the chance
      // that the first block we find sets a floor for the target timestamp. The loop converges on the correct block
      // slower than the following incremental search performed by `findBlock`, so we want to minimize the number of
      // loop iterations in favor of searching more blocks over the `findBlock` search.
      const cushion = 1;
      const incrementDistance = Math.max(
        // Ensure the increment block distance is _at least_ a single block to prevent an infinite loop.
        await estimateBlocksElapsed(initialBlock.timestamp - timestamp, cushion, this.chainId),
        1
      );

      // Search backwards by a constant increment until we find a block before the timestamp or hit block 0.
      for (let multiplier = 1; ; multiplier++) {
        const distance = multiplier * incrementDistance;
        const blockNumber = Math.max(0, initialBlock.number - distance);
        const block = await this.getBlock(blockNumber);
        if (block.timestamp <= timestamp) break; // Found an earlier block.
        assert(blockNumber > 0, "timestamp is before block 0"); // Block 0 was not earlier than this timestamp. The row.
      }
    }

    // Find the index where the block would be inserted and use that as the end block (since it is >= the timestamp).
    const index = sortedIndexBy(this.blocks, { timestamp } as T, "timestamp");
    return this.findBlock(this.blocks[index - 1], this.blocks[index], timestamp);
  }

  // Grabs the most recent block and caches it.
  private async getLatestBlock() {
    const block = await this.requestBlock("latest");
    const index = sortedIndexBy(this.blocks, block, "number");
    if (this.blocks[index]?.number !== block.number) this.blocks.splice(index, 0, block);
    return this.blocks[index];
  }

  // Grabs the block for a particular number and caches it.
  private async getBlock(number: number) {
    let index = sortedIndexBy(this.blocks, { number } as T, "number");
    if (this.blocks[index]?.number === number) return this.blocks[index]; // Return early if block already exists.
    const block = await this.requestBlock(number);

    // Recompute the index after the async call since the state of this.blocks could have changed!
    index = sortedIndexBy(this.blocks, { number } as T, "number");

    // Rerun this check to avoid duplicate insertion.
    if (this.blocks[index]?.number === number) return this.blocks[index];
    this.blocks.splice(index, 0, block); // A simple insert at index.
    return block;
  }

  // Return the latest block, between startBlock and endBlock, whose timestamp is <= timestamp.
  // Effectively, this is an interpolation search algorithm to minimize block requests.
  // Note: startBlock and endBlock _must_ be different blocks.
  private async findBlock(_startBlock: T, _endBlock: T, timestamp: number): Promise<T> {
    const [startBlock, endBlock] = [_startBlock, _endBlock] as WithoutStringTimestamp<T>[];
    // In the case of equality, the endBlock is expected to be passed as the one whose timestamp === the requested
    // timestamp.
    if (endBlock.timestamp === timestamp) return endBlock;

    // If there's no equality, but the blocks are adjacent, return the startBlock, since we want the returned block's
    // timestamp to be <= the requested timestamp.
    if (endBlock.number === startBlock.number + 1) return startBlock;

    assert(endBlock.number !== startBlock.number, "startBlock cannot equal endBlock");
    assert(
      timestamp < endBlock.timestamp && timestamp > startBlock.timestamp,
      "timestamp not in between start and end blocks"
    );

    // Interpolating the timestamp we're searching for to block numbers.
    const totalTimeDifference = endBlock.timestamp - startBlock.timestamp;
    const totalBlockDistance = endBlock.number - startBlock.number;
    const blockPercentile = (timestamp - startBlock.timestamp) / totalTimeDifference;
    const estimatedBlock = startBlock.number + Math.round(blockPercentile * totalBlockDistance);

    // Clamp ensures the estimated block is strictly greater than the start block and strictly less than the end block.
    const newBlock = await this.getBlock(clamp(estimatedBlock, startBlock.number + 1, endBlock.number - 1));

    // Depending on whether the new block is below or above the timestamp, narrow the search space accordingly.
    if (newBlock.timestamp < timestamp) {
      return this.findBlock(newBlock, endBlock, timestamp);
    } else {
      return this.findBlock(startBlock, newBlock, timestamp);
    }
  }
}
