require("dotenv").config();
import lodash from "lodash";
import assert from "assert";
import Promise from "bluebird";
import { ethers } from "ethers";

import { Positions, Position, Pool, Balances } from "./models";
import { PoolClient, BlockNumber } from "./contracts";
import { exists, IsPositionActive, liquidityPerTick, percentShares } from "./utils";

type Config = {
  poolClient: PoolClient;
};

// This class contains logic for calculating simple liquidity ratios for all active positions a single univ3 pool
// You have the option to calculate this based on latest block, or a range of blocks ( requiring archive node)
export default (config: Config) => {
  const { poolClient } = config;

  // fetch all needed contract state given a block number
  async function stateAtBlock(params: {
    blockNumber: BlockNumber;
    allPositions: Positions;
    poolClient: PoolClient;
    poolAddress: string;
  }) {
    const { blockNumber, allPositions, poolClient, poolAddress } = params;
    const poolState = await poolClient.getPoolState({ address: poolAddress, blockNumber });
    // this pulls all positions that existed at this block number
    const existingPositions = await allPositions.lteBlockNumber(blockNumber);
    // get state from positions that existed on or before this block
    const positions = await Promise.mapSeries(existingPositions, async (position) => {
      return { ...position, ...(await poolClient.getPositionState({ address: poolAddress, position, blockNumber })) };
    });
    return {
      poolState,
      positions,
    };
  }

  // sums this blocks liquidity across all positions and returns a Balances table which contains the liquidity
  async function addLiquidity(params: { positions: Position[]; poolState: Pool }, allLiquidity: Balances) {
    const { poolState, positions } = params;
    assert(exists(poolState.tick), "requires tick");
    const activePositions = positions.filter(IsPositionActive(poolState.tick));
    return activePositions.reduce((allLiquidity, position) => {
      const liquidity = liquidityPerTick(position);
      allLiquidity.add(position.operator, liquidity);
      return allLiquidity;
    }, allLiquidity);
  }

  // given all position liquidity values, total liquidity, calculate the percent share of rewards
  function calculateDistribution(allLiquidity: Balances, rewards: number) {
    const snapshot = allLiquidity.snapshot();
    const total = allLiquidity.getTotal();
    return percentShares(snapshot, total, ethers.utils.parseUnits(rewards.toString()).toString());
  }

  // just turns wei into decimals across an object
  function formatDisplay(distribution: ReturnType<Balances["snapshot"]>) {
    return lodash.mapValues(distribution, (balance) => ethers.utils.formatUnits(balance));
  }

  // helper function to inintialize necessary empty table state for storage
  async function initTables(poolAddress: string) {
    const pool: Pool = { address: poolAddress, id: poolAddress };
    const allLiquidity = Balances();
    const allPositions = Positions();

    // seed positions
    await poolClient.processEvents({
      pool,
      positions: allPositions,
    });
    return {
      pool,
      allLiquidity,
      allPositions,
    };
  }

  // run liquidity mining only against the latest block state
  async function processLatestBlock({ rewards, poolAddress }: { rewards: number; poolAddress: string }) {
    const { allLiquidity, allPositions } = await initTables(poolAddress);
    const state = await stateAtBlock({ blockNumber: "latest", allPositions, poolClient, poolAddress });
    await addLiquidity(state, allLiquidity);
    const distribution = await calculateDistribution(allLiquidity, rewards);
    return formatDisplay(distribution);
  }

  // main entrypoint to process relative liquidity for a pool between block numbers
  async function processBlocks(params: {
    startBlock: number;
    endBlock: number;
    sampleRate: number;
    rewards: number;
    poolAddress: string;
  }) {
    const { startBlock, endBlock, sampleRate, rewards, poolAddress } = params;

    const { allLiquidity, allPositions } = await initTables(poolAddress);

    for (let i = startBlock; i <= endBlock; i += sampleRate) {
      const state = await stateAtBlock({ blockNumber: i, allPositions, poolClient, poolAddress });
      await addLiquidity(state, allLiquidity);
    }
    const distribution = calculateDistribution(allLiquidity, rewards);
    return formatDisplay(distribution);
  }

  return {
    processBlocks,
    processLatestBlock,
    utils: {
      formatDisplay,
      initTables,
      calculateDistribution,
      addLiquidity,
      stateAtBlock,
    },
  };
};
