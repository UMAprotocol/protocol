const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const Registry = artifacts.require("Registry");
const CentralizedOracle = artifacts.require("CentralizedOracle");
const { getKeysForNetwork } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const registry = await Registry.deployed();
  const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();

  // Add creator contract to the registry.
  await registry.addDerivativeCreator(tokenizedDerivativeCreator.address, { from: keys.registry });
};
