const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const { getKeysForNetwork, deployAndGet, addToTdr } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const financialContractsAdmin = await deployAndGet(deployer, FinancialContractsAdmin, { from: keys.deployer });
  await addToTdr(financialContractsAdmin, network);
};
