const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Finder = artifacts.require("Finder");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const Store = artifacts.require("Store");
const { getKeysForNetwork, deploy, addToTdr } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  await deploy(deployer, network, Finder, { from: keys.deployer });
};
