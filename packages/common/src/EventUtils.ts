import { Promise } from "bluebird";
import { Contract, Event, EventFilter } from "ethers";

const defaultConcurrency = 200;
const maxRetries = 3;
const retrySleepTime = 10;

function delay(s: number) {
  return new Promise((resolve) => setTimeout(resolve, s * 1000));
}
export interface EventSearchConfig {
  fromBlock: number;
  toBlock: number;
  maxBlockLookBack?: number;
  concurrency?: number;
}

export async function paginatedEventQuery<T extends Event>(
  contract: Contract,
  filter: EventFilter,
  searchConfig: EventSearchConfig,
  retryCount = 0
): Promise<Array<T>> {
  // If the max block look back is set to 0 then we dont need to do any pagination and can query over the whole range.
  if (searchConfig.maxBlockLookBack === 0)
    return (await contract.queryFilter(filter, searchConfig.fromBlock, searchConfig.toBlock)) as Array<T>;

  // Compute the number of queries needed. If there is no maxBlockLookBack set then we can execute the whole query in
  // one go. Else, the number of queries is the range over which we are searching, divided by the maxBlockLookBack,
  // rounded up. This gives us the number of queries we need to execute to traverse the whole block range.
  const paginatedRanges = getPaginatedBlockRanges(searchConfig);

  try {
    return (
      (
        await Promise.map(paginatedRanges, ([fromBlock, toBlock]) => contract.queryFilter(filter, fromBlock, toBlock), {
          concurrency: typeof searchConfig.concurrency == "number" ? searchConfig.concurrency : defaultConcurrency,
        })
      )
        .flat()
        // Filter events by block number because ranges can include blocks that are outside the range specified for caching reasons.
        .filter(
          (event: Event) => event.blockNumber >= searchConfig.fromBlock && event.blockNumber <= searchConfig.toBlock
        ) as Array<T>
    );
  } catch (error) {
    if (retryCount < maxRetries) {
      await delay(retrySleepTime);
      return await paginatedEventQuery(contract, filter, searchConfig, retryCount + 1);
    } else throw error;
  }
}

/**
 * @dev Warning: this is a specialized function!! Its functionality is not obvious.
 * This function attempts to return block ranges to repeat ranges as much as possible. To do so, it may include blocks that
 * are outside the provided range. The guarantee is that it will always include _at least_ the blocks requested.
 * @param eventSearchConfig contains fromBlock, toBlock, and maxBlockLookBack.
 * The range is inclusive, so the results will include events in the fromBlock and in the toBlock.
 * maxBlockLookback defined the maximum number of blocks to search. Because the range is inclusive, the maximum diff
 * in the returned pairs is maxBlockLookBack - 1. This is a bit non-intuitive here, but this is meant so that this
 * parameter more closely aligns with the more commonly understood definition of a max query range that node providers
 * use.
 * @returns an array of disjoint fromBlock, toBlock ranges that should be queried. These cover at least the entire
 * input range, but can include blocks outside of the desired range, so results should be filtered. Results
 * are ordered from smallest to largest.
 */
export function getPaginatedBlockRanges({
  fromBlock,
  toBlock,
  maxBlockLookBack,
}: EventSearchConfig): [number, number][] {
  // If the maxBlockLookBack is undefined, we can look back as far as we like. Just return the entire range.
  if (maxBlockLookBack === undefined) return [[fromBlock, toBlock]];

  // If the fromBlock is > toBlock, then return no ranges.
  if (fromBlock > toBlock) return [];

  // A maxBlockLookBack of 0 is not allowed.
  if (maxBlockLookBack <= 0) throw new Error("Cannot set maxBlockLookBack <= 0");

  // Floor the requestedFromBlock to the nearest smaller multiple of the maxBlockLookBack to enhance caching.
  // This means that a range like 5 - 45 with a maxBlockLookBack of 20 would look like:
  // 0-19, 20-39, 40-45.
  // This allows us to get the max number of repeated node queries. The maximum number of "nonstandard" queries per
  // call of this function is 1.
  const flooredStartBlock = Math.floor(fromBlock / maxBlockLookBack) * maxBlockLookBack;

  // Note: range is inclusive, so we have to add one to the number of blocks to query.
  const iterations = Math.ceil((toBlock + 1 - flooredStartBlock) / maxBlockLookBack);

  const ranges: [number, number][] = [];
  for (let i = 0; i < iterations; i++) {
    // Each inner range start is just a multiple of the maxBlockLookBack added to the start block.
    const innerFromBlock = flooredStartBlock + maxBlockLookBack * i;

    // The innerFromBlock is just the max range from the innerFromBlock or the outer toBlock, whichever is smaller.
    // The end block should never be larger than the outer toBlock. This is to avoid querying blocks that are in the
    // future.
    const innerToBlock = Math.min(innerFromBlock + maxBlockLookBack - 1, toBlock);
    ranges.push([innerFromBlock, innerToBlock]);
  }

  return ranges;
}
