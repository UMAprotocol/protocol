const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Finder = artifacts.require("Finder");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");
const { interfaceName } = require("../utils/Constants.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const financialContractsAdmin = await deployAndGet(deployer, FinancialContractsAdmin, { from: keys.deployer });
  await addToTdr(financialContractsAdmin, network);

  const remarginRole = "1"; // Corresponds to FinancialContractsAdmin.Roles.Remargin.
  await financialContractsAdmin.addMember(remarginRole, keys.deployer);

  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(
    web3.utils.utf8ToHex(interfaceName.FinancialContractsAdmin),
    financialContractsAdmin.address,
    {
      from: keys.deployer
    }
  );
};
