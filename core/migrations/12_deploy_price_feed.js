const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const { getKeysForNetwork, enableControllableTiming, deploy } = require("../../common/MigrationUtils.js");
const Timer = artifacts.require("Timer");

module.exports = async function(deployer, network, accounts) {
  const controllableTiming = enableControllableTiming(network);
  const keys = getKeysForNetwork(network, accounts);

  await deploy(
    deployer,
    network,
    ManualPriceFeed,
    controllableTiming ? Timer.address : "0x0000000000000000000000000000000000000000",
    {
      from: keys.deployer
    }
  );
};
