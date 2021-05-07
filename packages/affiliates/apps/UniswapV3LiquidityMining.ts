// This app will run standard liquidity mining calculations on a single uniswapv3 pool.
// To run, first create a config json file with based on the Config type. For instance
// {
//   "poolAddress":"0x...",
//   "rewards": 100 // rewards are optional, and will default to 1 if not provided giving you % breakdown of positions
//   "startBlock": 12345 // optional block to start on, requires an archive node. If not provided defaults to latest.
//   "endBlock": 54321 // optional block to end on, requires an archive node. If not provided defaults to latest.
//   "sampleRate": 256 // number of blocks to skip between samples, defaults to 1 if not provided.
// }
// You must also provide CUSTOM_NODE_URL within your ENV set to an infura api for example.
// In a terminal in the root of the affiliates package run this to start the app:
// cat config.json | npx ts-node apps/UniswapV3LiquidityMining.ts
// The application will output your config file and a results object:
// {
// "config": your config file
// "results": {  // results will add up to config.rewards
//      address1: reward amount 1
//      address2: reward amount 2
//   }
// }

require("dotenv").config();
import LiquidityMining from "../libs/uniswap/liquidity";
import { PoolClient } from "../libs/uniswap/contracts";
import { exists } from "../libs/uniswap/utils";
import { ethers } from "ethers";
import assert from "assert";
const { makeUnixPipe } = require("../libs/affiliates/utils");

interface ProcessEnv {
  [key: string]: string | undefined;
}
type RewardResult = {
  // user address: reward amount as a float string
  [key: string]: string;
};
type Config = {
  poolAddress: string;
  rewards?: number;
  startBlock?: number;
  endBlock?: number;
  sampleRate?: number;
};

// default config values
const CONFIG_DEFAULTS = {
  // if rewards are set to 1, all positions will show a % value between 0 and 1
  rewards: 1,
  // if sample rate is 1 and you have start and end blocks, every block is sampled for state (requires archive)
  // this may be really slow, so you probably want to provide a larger number to skip blocks.
  sampleRate: 1
};

const App = (env: ProcessEnv) => async (config: Config) => {
  assert(env.CUSTOM_NODE_URL, "requires CUSTOM_NODE_URL for eth provider");
  const { poolAddress, rewards, startBlock, endBlock, sampleRate } = { ...CONFIG_DEFAULTS, ...config };

  const provider = ethers.getDefaultProvider(env.CUSTOM_NODE_URL);
  const poolClient = PoolClient(provider);
  const mining = LiquidityMining({ poolClient });

  let result: RewardResult;
  // we can omit start and end block and just see the rewards based on current time
  if (exists(startBlock) && exists(endBlock)) {
    result = await mining.processBlocks({ startBlock, endBlock, sampleRate, rewards, poolAddress });
  } else {
    result = await mining.processLatestBlock({ rewards, poolAddress });
  }
  return {
    config,
    result
  };
};

makeUnixPipe(App(process.env))
  .then(console.log)
  .catch(console.error)
  .finally(() => process.exit());
