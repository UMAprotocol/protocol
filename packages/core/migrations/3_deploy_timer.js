const Timer = artifacts.require("Timer");
const { getKeysForNetwork, deploy, enableControllableTiming } = require("@uma/common");

module.exports = async function (deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  if (controllableTiming) {
    await deploy(deployer, network, Timer, { from: keys.deployer });
  } else {
    return;
  }
};
