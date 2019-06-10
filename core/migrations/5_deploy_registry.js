const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const registry = await deployAndGet(deployer, Registry, { from: keys.deployer });
  await addToTdr(registry, network);

  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Registry), registry.address, {
    from: keys.deployer
  });
};
