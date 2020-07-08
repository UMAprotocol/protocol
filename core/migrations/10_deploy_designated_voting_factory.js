const DesignatedVotingFactory = artifacts.require("DesignatedVotingFactory");
const Finder = artifacts.require("Finder");
const { getKeysForNetwork, deploy } = require("@umaprotocol/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, DesignatedVotingFactory, Finder.address, { from: keys.deployer });
};
