import { getChainIdByUrl, getLatestBlockNumberByUrl } from "../utils/utils";

interface MonitoringParams {
  jsonRpcUrl: string;
  chainId: number;
  startingBlock: number;
  endingBlock: number;
  pollingDelay: number;
}

export const initCommonEnvVars = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  if (!env.CUSTOM_NODE_URL) throw new Error("CUSTOM_NODE_URL must be defined in env");
  const jsonRpcUrl = env.CUSTOM_NODE_URL;

  const chainId = await getChainIdByUrl(jsonRpcUrl);

  if (!chainId || (chainId != 1 && chainId != 5)) throw new Error("This script should be run on mainnet or goerli");

  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  if (pollingDelay === 0 && (!env.STARTING_BLOCK_NUMBER || !env.ENDING_BLOCK_NUMBER)) {
    throw new Error("Must provide STARTING_BLOCK_NUMBER and ENDING_BLOCK_NUMBER if running serverless");
  }

  // If no block numbers are privided, default to the latest block.
  const latestBlockNumber = await getLatestBlockNumberByUrl(jsonRpcUrl);
  const startingBlock = env.STARTING_BLOCK_NUMBER ? Number(env.STARTING_BLOCK_NUMBER) : latestBlockNumber;
  const endingBlock = env.ENDING_BLOCK_NUMBER ? Number(env.ENDING_BLOCK_NUMBER) : latestBlockNumber;
  if (startingBlock > endingBlock) {
    throw new Error("STARTING_BLOCK_NUMBER must be less than or equal to ENDING_BLOCK_NUMBER");
  }

  return {
    jsonRpcUrl,
    chainId,
    startingBlock,
    endingBlock,
    pollingDelay,
  };
};

export const updateBlockRange = async (params: MonitoringParams): Promise<void> => {
  const latestBlockNumber = await getLatestBlockNumberByUrl(params.jsonRpcUrl);
  params.startingBlock = params.endingBlock + 1;
  params.endingBlock = latestBlockNumber;
};
