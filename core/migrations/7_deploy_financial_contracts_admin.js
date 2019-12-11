const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Finder = artifacts.require("Finder");
const { getKeysForNetwork, deploy, addToTdr } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const { contract: financialContractsAdmin } = await deploy(deployer, network, FinancialContractsAdmin, {
    from: keys.deployer
  });

  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(
    web3.utils.utf8ToHex(interfaceName.FinancialContractsAdmin),
    financialContractsAdmin.address,
    {
      from: keys.deployer
    }
  );
};
