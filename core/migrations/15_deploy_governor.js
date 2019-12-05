const Governor = artifacts.require("Governor");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const { getKeysForNetwork, deploy, enableControllableTiming } = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  const { contract: governor } = await deploy(deployer, network, Governor, Finder.address, controllableTiming, {
    from: keys.deployer
  });

  // Add governor to registry so it can send price requests.
  const registry = await Registry.deployed();
  const derivativeCreatorRole = 2;
  await registry.addMember(derivativeCreatorRole, keys.deployer, { from: keys.deployer });
  await registry.registerDerivative([], governor.address, { from: keys.deployer });
  await registry.removeMember(derivativeCreatorRole, keys.deployer, { from: keys.deployer });

  // Make the governor a writer in the Voting contract.
  const voting = await Voting.deployed();
  const writerRole = 1;
  voting.addMember(writerRole, governor.address, { from: keys.deployer });
};
