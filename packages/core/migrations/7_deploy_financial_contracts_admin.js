const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Finder = artifacts.require("Finder");
const { interfaceName } = require("@uma/common");
const { getKeysForNetwork, deploy } = require("./MigrationUtils");

module.exports = async function (deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const { contract: financialContractsAdmin } = await deploy(deployer, network, FinancialContractsAdmin, {
    from: keys.deployer,
  });

  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(
    web3.utils.utf8ToHex(interfaceName.FinancialContractsAdmin),
    financialContractsAdmin.address,
    { from: keys.deployer }
  );
};
