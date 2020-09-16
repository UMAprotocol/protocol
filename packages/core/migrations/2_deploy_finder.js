const Finder = artifacts.require("Finder");
const { getKeysForNetwork, deploy } = require("@uma/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, Finder, { from: keys.deployer });
};
