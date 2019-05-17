const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const {
  getKeysForNetwork,
  enableControllableTiming,
  deployAndGet,
  addToTdr
} = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const controllableTiming = enableControllableTiming(network);
  const keys = getKeysForNetwork(network, accounts);

  const manualPriceFeed = await deployAndGet(deployer, ManualPriceFeed, controllableTiming, { from: keys.priceFeed });
  await addToTdr(manualPriceFeed, network);
};
