const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const leveragedReturnCalculator = await deployAndGet(deployer, LeveragedReturnCalculator, 1, { from: keys.deployer });
  await addToTdr(leveragedReturnCalculator, network);
};
