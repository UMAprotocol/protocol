// Note: for ropsten and mainnet deploys, the command should look as follows:
// $(npm bin)/truffle migrate --reset --network <ropsten_or_mainnet> \
// --keys={deployer,registry,store,priceFeed,sponsorWhitelist,returnCalculatorWhitelist,marginCurrencyWhitelist}

const Registry = artifacts.require("Registry");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const registry = await deployAndGet(deployer, Registry, { from: keys.registry });
  await addToTdr(registry, network);
};
