/**
 * @notice Deploy a new Balancer market.
 *
 *
 * Example: $(npm bin)/truffle exec ./scripts/local/DeployBalancerMock.js --network kovan_mnemonic
 */

// Deployed contract ABI's and addresses we need to fetch.
const BalancerMock = artifacts.require("BalancerMock");

// Contracts we need to interact with.
let balancer;

/** ***************************************************
 * Main Script
 /*****************************************************/
const deployBalancerMock = async (callback) => {
  try {
    balancer = await BalancerMock.new();
    console.log(`Deployed new BalancerMock @ ${balancer.address}`);
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

module.exports = deployBalancerMock;
