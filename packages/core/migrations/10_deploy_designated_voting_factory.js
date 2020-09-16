const DesignatedVotingFactory = artifacts.require("DesignatedVotingFactory");
const Finder = artifacts.require("Finder");
const { getKeysForNetwork, deploy } = require("@uma/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const finder = await Finder.deployed();

  await deploy(deployer, network, DesignatedVotingFactory, finder.address, { from: keys.deployer });
};
