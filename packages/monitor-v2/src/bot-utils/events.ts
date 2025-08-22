import type { Provider, Block } from "@ethersproject/abstract-provider";
import type { BlockFinder } from "@uma/sdk";

export interface EventSearchConfig {
  fromBlock: number;
  toBlock: number;
  maxBlockLookBack: number;
}

export const computeEventSearch = async (
  provider: Provider,
  blockFinder: BlockFinder<Block>,
  timeLookback: number,
  maxBlockLookBack: number
): Promise<EventSearchConfig> => {
  const currentBlock = await provider.getBlock("latest");
  const fromBlock = await blockFinder.getBlockForTimestamp(currentBlock.timestamp - timeLookback);
  return {
    fromBlock: fromBlock.number,
    toBlock: currentBlock.number,
    maxBlockLookBack,
  };
};
