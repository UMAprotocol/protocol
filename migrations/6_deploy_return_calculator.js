const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const { getKeysForNetwork } = require("./MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deployer.deploy(LeveragedReturnCalculator, 1, { from: keys.deployer });
};