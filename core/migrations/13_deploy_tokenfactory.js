const TokenFactory = artifacts.require("TokenFactory");
const { getKeysForNetwork, deploy } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, TokenFactory, { from: keys.deployer });
};
