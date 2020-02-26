const Finder = artifacts.require("Finder");
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const { getKeysForNetwork, deploy, enableControllableTiming } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  const finder = await Finder.deployed();

  await deploy(deployer, network, ExpiringMultiPartyCreator, controllableTiming, finder.address, {
    from: keys.deployer
  });
};
