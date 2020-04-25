const Finder = artifacts.require("Finder");
const Store = artifacts.require("Store");
const Timer = artifacts.require("Timer");

const { getKeysForNetwork, deploy, enableControllableTiming } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // Initialize both fees to 0.
  const initialFixedOracleFeePerSecondPerPfc = { rawValue: "0" };
  const initialWeeklyDelayFeePerSecondPerPfc = { rawValue: "0" };

  const { contract: store } = await deploy(
    deployer,
    network,
    Store,
    initialFixedOracleFeePerSecondPerPfc,
    initialWeeklyDelayFeePerSecondPerPfc,
    controllableTiming ? Timer.address : "0x0000000000000000000000000000000000000000",
    { from: keys.deployer }
  );

  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Store), store.address, {
    from: keys.deployer
  });
};
