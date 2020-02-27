const Governor = artifacts.require("Governor");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const { getKeysForNetwork, deploy, enableControllableTiming } = require("../../common/MigrationUtils.js");
const { RegistryRolesEnum } = require("../../common/Enums.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  const { contract: governor } = await deploy(deployer, network, Governor, Finder.address, controllableTiming, {
    from: keys.deployer
  });

  // Add governor to registry so it can send price requests.
  const registry = await Registry.deployed();
  await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, keys.deployer, { from: keys.deployer });
  await registry.registerDerivative([], governor.address, { from: keys.deployer });
  await registry.removeMember(RegistryRolesEnum.DERIVATIVE_CREATOR, keys.deployer, { from: keys.deployer });

  // TODO: make the governor the owner of the Registry, Finder, FinancialContractsAdmin, Store, Voting, and
  // VotingToken for prod deployments.
};
