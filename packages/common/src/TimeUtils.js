const { UMA_FIRST_EMP_BLOCK } = require("./Constants.js");
require("dotenv").config();

/**
 * @notice Return average block-time for a period.
 */
async function averageBlockTimeSeconds(/* lookbackSeconds */) {
  // TODO: Call an external API to get this data. Currently this value is a hard-coded estimate
  // based on the data from https://etherscan.io/chart/blocktime. ~13.5 seconds has been the average
  // since April 2016, although this value seems to spike periodically for a relatively short period of time.
  const defaultBlockTimeSeconds = 13.5;

  if (!defaultBlockTimeSeconds) {
    throw "Missing default block time value";
  } else {
    return defaultBlockTimeSeconds;
  }
}

// Sets fromBlock to the value of an environment variable if one is set. This can be set to 0 to make tests work with Ganache, or any other value needed for a production script or bot.
async function getFromBlock(web3) {
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
async function estimateBlocksElapsed(seconds, cushionPercentage = 0.0) {
  const cushionMultiplier = cushionPercentage + 1.0;
  const averageBlockTime = await averageBlockTimeSeconds();
  return Math.floor((seconds * cushionMultiplier) / averageBlockTime);
}

module.exports = { averageBlockTimeSeconds, getFromBlock, estimateBlocksElapsed };
