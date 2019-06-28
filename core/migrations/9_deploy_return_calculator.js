const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const { getKeysForNetwork, deploy, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, LeveragedReturnCalculator, 1, { from: keys.deployer });
};
