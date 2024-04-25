import { UMA_FIRST_EMP_BLOCK } from "./Constants";
import dotenv from "dotenv";
import type Web3 from "web3";
dotenv.config();

/**
 * @notice Return average block-time for a period.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function averageBlockTimeSeconds(chainId?: number): Promise<number> {
  // TODO: Call an external API to get this data. Currently this value is a hard-coded estimate
  // based on the data from https://etherscan.io/chart/blocktime. ~13.5 seconds has been the average
  // since April 2016, although this value seems to spike periodically for a relatively short period of time.
  const defaultBlockTimeSeconds = 12;
  if (!defaultBlockTimeSeconds) {
    throw "Missing default block time value";
  }

  switch (chainId) {
    // Source: https://polygonscan.com/chart/blocktime
    case 10:
      return 0.5;
    case 42161:
      return 0.5;
    case 288:
      return 150;
    case 137:
      return 2.5;
    case 1115:
      return 3;
    case 1116:
      return 3;
    case 8453:
      return 2;
    case 81457:
      return 2;
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
