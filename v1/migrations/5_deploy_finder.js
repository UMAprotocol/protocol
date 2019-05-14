const Finder = artifacts.require("Finder");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const finder = await deployAndGet(deployer, Finder, { from: keys.deployer });
  await addToTdr(finder, network);
};
