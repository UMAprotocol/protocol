const Governor = artifacts.require("Governor");
const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Timer = artifacts.require("Timer");
const { getKeysForNetwork, deploy, enableControllableTiming, RegistryRolesEnum } = require("@uma/common");

module.exports = async function (deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);
  const startingId = "0";

  // .deployed() will fail if called on a network where the is no Timer (!controllableTiming).
  const timerAddress = controllableTiming
    ? (await Timer.deployed()).address
    : "0x0000000000000000000000000000000000000000";
  const finder = await Finder.deployed();

  const { contract: governor } = await deploy(deployer, network, Governor, finder.address, startingId, timerAddress, {
    from: keys.deployer,
  });

  // Add governor to registry so it can send price requests.
  const registry = await Registry.deployed();
  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, keys.deployer, { from: keys.deployer });
  await registry.registerContract([], governor.address, { from: keys.deployer });
  await registry.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, keys.deployer, { from: keys.deployer });

  // TODO: make the governor the owner of the Registry, Finder, FinancialContractsAdmin, Store, Voting, and
  // VotingToken for prod deployments.
};
