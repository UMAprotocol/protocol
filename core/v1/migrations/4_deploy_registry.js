const Registry = artifacts.require("Registry");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const registry = await deployAndGet(deployer, Registry, { from: keys.deployer });
  await addToTdr(registry, network);
};
