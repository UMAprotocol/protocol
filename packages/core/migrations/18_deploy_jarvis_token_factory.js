const JarvisTokenFactory = artifacts.require("JarvisTokenFactory");
const { getKeysForNetwork, deploy } = require("@uma/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, JarvisTokenFactory, { from: keys.deployer });
};
