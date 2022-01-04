import { UMA_FIRST_EMP_BLOCK } from "./Constants";
import dotenv from "dotenv";
import type Web3 from "web3";
dotenv.config();

/**
 * @notice Return average block-time for a period.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function averageBlockTimeSeconds(networkId?: number): Promise<number> {
  // TODO: Call an external API to get this data. Currently this value is a hard-coded estimate
  // based on the data from https://etherscan.io/chart/blocktime. ~13.5 seconds has been the average
  // since April 2016, although this value seems to spike periodically for a relatively short period of time.
  const defaultBlockTimeSeconds = 13.5;
  if (!defaultBlockTimeSeconds) {
    throw "Missing default block time value";
  }

  switch (networkId) {
    // Block time is irrelevant on Arbitrum since one transaction ~= 1 block, so this time value is based on empirical
    // observation as of January 4 2022 of Arbitrum block propogation.
    case 42161:
      return 2.2;
    // Source: https://polygonscan.com/chart/blocktime
    case 137:
      return 2.2;
    case 1:
      return defaultBlockTimeSeconds;
    default:
      return defaultBlockTimeSeconds;
  }
}

// Sets fromBlock to the value of an environment variable if one is set. This can be set to 0 to make tests work with Ganache, or any other value needed for a production script or bot.
export async function getFromBlock(web3: Web3): Promise<number> {
  const networkType = await web3.eth.net.getNetworkType();
  if (process.env.FROM_BLOCK) {
    return Number(process.env.FROM_BLOCK);
  } else if (networkType === "main") {
    return UMA_FIRST_EMP_BLOCK;
  } else {
    return 0;
  }
}

/**
 * @notice Estimates the blocks elapsed over a certain number of seconds.
 * @param seconds the number of seconds.
 * @param cushionPercentage the percentage to add to the number as a cushion.
 */
export async function estimateBlocksElapsed(seconds: number, cushionPercentage = 0.0): Promise<number> {
  const cushionMultiplier = cushionPercentage + 1.0;
  const averageBlockTime = await averageBlockTimeSeconds();
  return Math.floor((seconds * cushionMultiplier) / averageBlockTime);
}
