const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const { getKeysForNetwork, enableControllableTiming, deploy, addToTdr } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const controllableTiming = enableControllableTiming(network);
  const keys = getKeysForNetwork(network, accounts);

  const { contract: manualPriceFeed } = await deploy(deployer, network, ManualPriceFeed, controllableTiming, {
    from: keys.deployer
  });
};
