const MintableBurnableTokenFactory = artifacts.require("MintableBurnableTokenFactory");
const { getKeysForNetwork, deploy } = require("@uma/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, MintableBurnableTokenFactory, { from: keys.deployer });
};
