const Finder = artifacts.require("Finder");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const { getKeysForNetwork, enableControllableTiming, deploy, addToTdr } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const controllableTiming = enableControllableTiming(network);
  const keys = getKeysForNetwork(network, accounts);

  const { contract: manualPriceFeed } = await deploy(deployer, network, ManualPriceFeed, controllableTiming, {
    from: keys.priceFeed
  });

  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.PriceFeed), manualPriceFeed.address, {
    from: keys.deployer
  });
};
