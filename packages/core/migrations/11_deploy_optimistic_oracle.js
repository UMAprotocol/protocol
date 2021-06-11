const OptimisticOracle = artifacts.require("OptimisticOracle");
const Finder = artifacts.require("Finder");
const Timer = artifacts.require("Timer");
const Registry = artifacts.require("Registry");
const {
  getKeysForNetwork,
  deploy,
  enableControllableTiming,
  interfaceName,
  RegistryRolesEnum,
} = require("@uma/common");

module.exports = async function (deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  const finder = await Finder.deployed();
  // .deployed() will fail if called on a network where the is no Timer (!controllableTiming).
  const timerAddress = controllableTiming
    ? (await Timer.deployed()).address
    : "0x0000000000000000000000000000000000000000";

  // 2 hours.
  const defaultLiveness = 7200;

  const { contract: optimisticOracle } = await deploy(
    deployer,
    network,
    OptimisticOracle,
    defaultLiveness,
    finder.address,
    timerAddress,
    { from: keys.deployer }
  );

  await finder.changeImplementationAddress(
    web3.utils.utf8ToHex(interfaceName.OptimisticOracle),
    optimisticOracle.address,
    { from: keys.deployer }
  );

  // Register OO with Voting so it can make price requests.
  const registry = await Registry.deployed();
  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, keys.deployer, { from: keys.deployer });
  await registry.registerContract([], optimisticOracle.address, { from: keys.deployer });
  await registry.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, keys.deployer, { from: keys.deployer });
};
