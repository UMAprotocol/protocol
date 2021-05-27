const Finder = artifacts.require("Finder");
const Store = artifacts.require("Store");
const Timer = artifacts.require("Timer");

const { getKeysForNetwork, deploy, enableControllableTiming, interfaceName } = require("@uma/common");

module.exports = async function (deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // .deployed() will fail if called on a network where the is no Timer (!controllableTiming).
  const timerAddress = controllableTiming
    ? (await Timer.deployed()).address
    : "0x0000000000000000000000000000000000000000";

  // Initialize both fees to 0.
  const initialFixedOracleFeePerSecondPerPfc = { rawValue: "0" };
  const initialWeeklyDelayFeePerSecondPerPfc = { rawValue: "0" };

  const { contract: store } = await deploy(
    deployer,
    network,
    Store,
    initialFixedOracleFeePerSecondPerPfc,
    initialWeeklyDelayFeePerSecondPerPfc,
    timerAddress,
    { from: keys.deployer }
  );

  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Store), store.address, {
    from: keys.deployer,
  });
};
