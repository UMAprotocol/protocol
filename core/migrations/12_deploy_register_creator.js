const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const Registry = artifacts.require("Registry");
const { getKeysForNetwork } = require("../../common/MigrationUtils.js");
const { RegistryRolesEnum } = require("../utils/Enums.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);

  const registry = await Registry.deployed();
  const tokenizedDerivativeCreator = await TokenizedDerivativeCreator.deployed();

  // Add creator contract to the registry.
  await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, tokenizedDerivativeCreator.address, {
    from: keys.registry
  });
};
