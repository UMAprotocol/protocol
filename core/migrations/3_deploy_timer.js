const Timer = artifacts.require("Timer");
const { getKeysForNetwork, deploy } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, Timer, { from: keys.deployer });
};
