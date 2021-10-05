import { AppState } from "../types";

type Config = undefined;
type Dependencies = Pick<AppState, "blocks" | "provider">;

export default (config: Config, appState: Dependencies) => {
  const { blocks, provider } = appState;

  async function handleNewBlock(blockNumber: number) {
    const block = await provider.getBlock(blockNumber);
    if (await blocks.has(blockNumber)) return;
    await blocks.create({
      hash: block.hash,
      number: block.number,
      timestamp: block.timestamp,
    });
  }

  async function cleanBlocks(olderThanMs: number) {
    // convert to absolute time in seconds
    const timestamp = (Date.now() - olderThanMs) / 1000;
    await blocks.prune(timestamp);
  }

  return {
    handleNewBlock,
    cleanBlocks,
  };
};
