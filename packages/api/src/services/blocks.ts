import { Json, Libs } from "..";
export default (config: Json, libs: Libs) => {
  const { blocks, provider } = libs;

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
