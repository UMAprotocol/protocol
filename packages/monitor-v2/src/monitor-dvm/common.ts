import { getRetryProvider } from "@uma/common";
import { delay } from "@uma/financial-templates-lib";
import { BigNumber, utils } from "ethers";

import type { Provider } from "@ethersproject/abstract-provider";

export interface BotModes {
  unstakesEnabled: boolean;
  stakesEnabled: boolean;
  governanceEnabled: boolean;
  deletionEnabled: boolean;
  emergencyEnabled: boolean;
  rolledEnabled: boolean;
  governorTransfersEnabled: boolean;
  mintsEnabled: boolean;
}

export interface BlockRange {
  start: number;
  end: number;
}

export interface MonitoringParams {
  provider: Provider;
  chainId: number;
  blockRange: BlockRange;
  pollingDelay: number;
  botModes: BotModes;
  unstakeThreshold: BigNumber;
  stakeThreshold: BigNumber;
  governorTransfersThreshold: BigNumber;
  mintsThreshold: BigNumber;
}

export const initMonitoringParams = async (env: NodeJS.ProcessEnv): Promise<MonitoringParams> => {
  if (!env.CHAIN_ID) throw new Error("CHAIN_ID must be defined in env");
  const chainId = Number(env.CHAIN_ID);

  if (!chainId || (chainId != 1 && chainId != 5)) throw new Error("This script should be run on mainnet or goerli");

  const STARTING_BLOCK_KEY = `STARTING_BLOCK_NUMBER_${chainId}`;
  const ENDING_BLOCK_KEY = `ENDING_BLOCK_NUMBER_${chainId}`;

  // Creating provider will check for other chainId specific env variables.
  const provider = getRetryProvider(chainId) as Provider;

  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  if (pollingDelay === 0 && (!env[STARTING_BLOCK_KEY] || !env[ENDING_BLOCK_KEY])) {
    throw new Error(`Must provide ${STARTING_BLOCK_KEY} and ${ENDING_BLOCK_KEY} if running serverless`);
  }

  // If no block numbers are provided, default to the latest block.
  const latestBlockNumber: number = await provider.getBlockNumber();
  const startingBlock = env[STARTING_BLOCK_KEY] ? Number(env[STARTING_BLOCK_KEY]) : latestBlockNumber;
  const endingBlock = env[ENDING_BLOCK_KEY] ? Number(env[ENDING_BLOCK_KEY]) : latestBlockNumber;
  // In serverless it is possible for start block to be larger than end block if no new blocks were mined since last run.
  if (startingBlock > endingBlock && pollingDelay !== 0) {
    throw new Error(`${STARTING_BLOCK_KEY} must be less than or equal to ${ENDING_BLOCK_KEY}`);
  }

  const botModes = {
    unstakesEnabled: env.UNSTAKES_ENABLED === "true",
    stakesEnabled: env.STAKES_ENABLED === "true",
    governanceEnabled: env.GOVERNANCE_ENABLED === "true",
    deletionEnabled: env.DELETION_ENABLED === "true",
    emergencyEnabled: env.EMERGENCY_ENABLED === "true",
    rolledEnabled: env.ROLLED_ENABLED === "true",
    governorTransfersEnabled: env.GOVERNOR_TRANSFERS_ENABLED === "true",
    mintsEnabled: env.MINTS_ENABLED === "true",
  };

  // Parse all bot mode specific parameters.
  const unstakeThreshold = utils.parseEther(process.env.UNSTAKE_THRESHOLD || "0");
  const stakeThreshold = utils.parseEther(process.env.STAKE_THRESHOLD || "0");
  const governorTransfersThreshold = utils.parseEther(process.env.GOVERNOR_TRANSFERS_THRESHOLD || "0");
  const mintsThreshold = utils.parseEther(process.env.MINTS_THRESHOLD || "0");

  return {
    provider,
    chainId,
    blockRange: { start: startingBlock, end: endingBlock },
    pollingDelay,
    botModes,
    unstakeThreshold,
    stakeThreshold,
    governorTransfersThreshold,
    mintsThreshold,
  };
};

export const waitNextBlockRange = async (params: MonitoringParams): Promise<BlockRange> => {
  await delay(Number(params.pollingDelay));
  const latestBlockNumber: number = await params.provider.getBlockNumber();
  return { start: params.blockRange.end + 1, end: latestBlockNumber };
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return params.pollingDelay === 0 ? "debug" : "info";
};

export const tryHexToUtf8String = (ancillaryData: string): string => {
  try {
    return utils.toUtf8String(ancillaryData);
  } catch (err) {
    return ancillaryData;
  }
};
