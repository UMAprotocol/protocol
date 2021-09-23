/**
 * @notice Deploy a new UniswapMock market.
 *
 *
 * Example: $(npm bin)/truffle exec ./scripts/local/DeployUniswapMock.js --network kovan_mnemonic
 */

// Deployed contract ABI's and addresses we need to fetch.
const UniswapMock = artifacts.require("UniswapMock");

// Contracts we need to interact with.
let uniswap;

/** ***************************************************
 * Main Script
 /*****************************************************/
const deployUniswapMock = async (callback) => {
  try {
    uniswap = await UniswapMock.new();
    console.log(`Deployed new UniswapMock @ ${uniswap.address}`);
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = deployUniswapMock;
