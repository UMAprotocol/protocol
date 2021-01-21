const Finder = artifacts.require("Finder");
const PerpetualCreator = artifacts.require("PerpetualCreator");
const PerpetualLib = artifacts.require("PerpetualLib");
const TokenFactory = artifacts.require("TokenFactory");
const Timer = artifacts.require("Timer");
const Registry = artifacts.require("Registry");
const { RegistryRolesEnum, getKeysForNetwork, deploy, enableControllableTiming } = require("@uma/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  const finder = await Finder.deployed();

  // .deployed() will fail if called on a network where the is no Timer (!controllableTiming).
  const timerAddress = controllableTiming
    ? (await Timer.deployed()).address
    : "0x0000000000000000000000000000000000000000";
  const tokenFactory = await TokenFactory.deployed();
  const registry = await Registry.deployed();

  // Deploy PerpLib and link to PerpCreator.

  // hardhat
  if (PerpetualLib.setAsDeployed) {
    const { contract: perpLib } = await deploy(deployer, network, PerpetualLib);

    // Due to how truffle-plugin works, it statefully links it
    // and throws an error if its already linked. So we'll just ignore it...
    try {
      await PerpetualCreator.link(perpLib);
    } catch (e) {
      // Allow this to fail in the hardhat case.
    }
  } else {
    // Truffle
    await deploy(deployer, network, PerpetualLib);
    await deployer.link(PerpetualLib, PerpetualCreator);
  }

  const { contract: perpetualCreator } = await deploy(
    deployer,
    network,
    PerpetualCreator,
    finder.address,
    tokenFactory.address,
    timerAddress,
    { from: keys.deployer }
  );

  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, perpetualCreator.address);
};
