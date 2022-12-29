import { getChainIdByUrl, getLatestBlockNumberByUrl } from "../utils/utils";
import { VotingV2Ethers } from "@uma/contracts-node";
import { delay } from "@uma/financial-templates-lib";
import { BigNumber, utils } from "ethers";

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
  jsonRpcUrl: string;
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
  if (!env.CUSTOM_NODE_URL) throw new Error("CUSTOM_NODE_URL must be defined in env");
  const jsonRpcUrl = env.CUSTOM_NODE_URL;

  const chainId = await getChainIdByUrl(jsonRpcUrl);

  if (!chainId || (chainId != 1 && chainId != 5)) throw new Error("This script should be run on mainnet or goerli");

  // Default to 1 minute polling delay.
  const pollingDelay = env.POLLING_DELAY ? Number(env.POLLING_DELAY) : 60;

  if (pollingDelay === 0 && (!env.STARTING_BLOCK_NUMBER || !env.ENDING_BLOCK_NUMBER)) {
    throw new Error("Must provide STARTING_BLOCK_NUMBER and ENDING_BLOCK_NUMBER if running serverless");
  }

  // If no block numbers are provided, default to the latest block.
  const latestBlockNumber = await getLatestBlockNumberByUrl(jsonRpcUrl);
  const startingBlock = env.STARTING_BLOCK_NUMBER ? Number(env.STARTING_BLOCK_NUMBER) : latestBlockNumber;
  const endingBlock = env.ENDING_BLOCK_NUMBER ? Number(env.ENDING_BLOCK_NUMBER) : latestBlockNumber;
  if (startingBlock > endingBlock) {
    throw new Error("STARTING_BLOCK_NUMBER must be less than or equal to ENDING_BLOCK_NUMBER");
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
    jsonRpcUrl,
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
  const latestBlockNumber = await getLatestBlockNumberByUrl(params.jsonRpcUrl);
  return { start: params.blockRange.end + 1, end: latestBlockNumber };
};

export const checkEndBlockVotingRound = async (
  blockRange: BlockRange,
  votingV2: VotingV2Ethers
): Promise<{ isNew: boolean; roundId: BigNumber }> => {
  // Compute end block round id.
  const endTime = BigNumber.from((await votingV2.provider.getBlock(blockRange.end)).timestamp);
  const roundLength = (await votingV2.voteTiming()).phaseLength.mul(2);
  const roundId = endTime.div(roundLength);

  // Compute previous checked round id only if there is a previous block.
  if (blockRange.start === 0) return { isNew: true, roundId };

  // Compute previous round id.
  const previousTime = BigNumber.from((await votingV2.provider.getBlock(blockRange.start - 1)).timestamp);
  const previousRoundId = previousTime.div(roundLength);

  return { isNew: !roundId.eq(previousRoundId), roundId };
};

export const getRequestId = (identifier: string, time: BigNumber, ancillaryData: string): string => {
  return utils.keccak256(
    utils.defaultAbiCoder.encode(["bytes32", "uint256", "bytes"], [identifier, time, ancillaryData])
  );
};

export const startupLogLevel = (params: MonitoringParams): "debug" | "info" => {
  return params.pollingDelay === 0 ? "debug" : "info";
};
