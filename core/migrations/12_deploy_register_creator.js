const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const Registry = artifacts.require("Registry");
const { getKeysForNetwork } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const registry = await Registry.deployed();
  const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();

  // Add creator contract to the registry.
  const derivativeCreatorRole = "2"; // Corresponds to Registry.Roles.DerivativeCreator.
  await registry.addMember(derivativeCreatorRole, tokenizedDerivativeCreator.address, { from: keys.registry });
};
