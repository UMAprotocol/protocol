const { UMA_FIRST_EMP_BLOCK } = require("./Constants.js");

/**
 * @notice Return average block-time for a period.
 */
const averageBlockTimeSeconds = async (/* lookbackSeconds */) => {
  // TODO: Call an external API to get this data. Currently this value is a hard-coded estimate
  // based on the data from https://etherscan.io/chart/blocktime. ~13.5 seconds has been the average
  // since April 2016, although this value seems to spike periodically for a relatively short period of time.
  const defaultBlockTimeSeconds = 13.5;

  if (!defaultBlockTimeSeconds) {
    throw "Missing default block time value";
  } else {
    return defaultBlockTimeSeconds;
  }
};

// Sets fromBlock to the value of an environment variable if one is set. This can be set to 0 to make tests work with Ganache, or any other value needed for a production script or bot.
async function getFromBlock() {
  if (process.env.FROM_BLOCK) {
    return process.env.FROM_BLOCK;
  } else {
    return UMA_FIRST_EMP_BLOCK;
  }
}

module.exports = {
  averageBlockTimeSeconds,
  getFromBlock
};
