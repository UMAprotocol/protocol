const argv = require("minimist")(process.argv.slice(), { string: ["token1", "token2"] });

const { getUniswapPairDetails } = require("@uma/financial-templates-lib");

const getUniswapPairAddress = async function (callback) {
  try {
    const { pairAddress } = await getUniswapPairDetails(web3, argv.token1, argv.token2);

    console.log(`Uniswap V2 pair address for tokens ${argv.token1} and ${argv.token2} is ${pairAddress}`);
  } catch (e) {
    console.log(`ERROR: ${e}`);
  }

  callback();
};

module.exports = getUniswapPairAddress;
