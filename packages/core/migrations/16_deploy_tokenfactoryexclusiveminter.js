const TokenFactoryExclusiveMinter = artifacts.require("TokenFactoryExclusiveMinter");
const { getKeysForNetwork, deploy } = require("@uma/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, TokenFactoryExclusiveMinter, { from: keys.deployer });
};
