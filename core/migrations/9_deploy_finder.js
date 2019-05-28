const Finder = artifacts.require("Finder");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const CentralizedStore = artifacts.require("CentralizedStore");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const finder = await deployAndGet(deployer, Finder, { from: keys.deployer });
  await addToTdr(finder, network);

  const registry = await Registry.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Registry), registry.address, {
    from: keys.deployer
  });

  const voting = await Voting.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), voting.address, {
    from: keys.deployer
  });

  const store = await CentralizedStore.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Store), store.address, {
    from: keys.deployer
  });

  const priceFeed = await ManualPriceFeed.deployed();
  await finder.changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.PriceFeed), priceFeed.address, {
    from: keys.deployer
  });
};
