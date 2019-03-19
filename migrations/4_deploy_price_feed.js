const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const { getKeysForNetwork, enableControllableTiming } = require("./MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const controllableTiming = enableControllableTiming(network);
  const keys = getKeysForNetwork(network, accounts);

  await deployer.deploy(ManualPriceFeed, controllableTiming, { from: keys.priceFeed });
};
