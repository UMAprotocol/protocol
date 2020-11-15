const Finder = artifacts.require("Finder");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const JarvisTokenFactory = artifacts.require("JarvisTokenFactory");
const FeePayerPoolPartyLib = artifacts.require("FeePayerPoolPartyLib");
const PerpetualPositionManagerPoolPartyLib = artifacts.require("PerpetualPositionManagerPoolPartyLib");
const PerpetualLiquidatablePoolPartyLib = artifacts.require("PerpetualLiquidatablePoolPartyLib");
const PerpetualPoolParty = artifacts.require("PerpetualPoolParty");
const PerpetualPoolPartyLib = artifacts.require("PerpetualPoolPartyLib");
const PerpetualPoolPartyCreator = artifacts.require("PerpetualPoolPartyCreator");
const Timer = artifacts.require("Timer");
const Registry = artifacts.require("Registry");
const TestnetERC20 = artifacts.require("TestnetERC20");
const {
  RegistryRolesEnum,
  interfaceName,
  getKeysForNetwork,
  deploy,
  enableControllableTiming
} = require("@uma/common");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // Use already deployed contract
  let collateralWhitelist = await AddressWhitelist.deployed();

  // Add CollateralWhitelist to finder.
  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(
    web3.utils.utf8ToHex(interfaceName.CollateralWhitelist),
    collateralWhitelist.address,
    {
      from: keys.deployer
    }
  );

  // Add the testnet ERC20 as the default collateral currency (this is the DAI address on mainnet).
  const testnetERC20 = await TestnetERC20.deployed();
  await collateralWhitelist.addToWhitelist(testnetERC20.address);

  // .deployed() will fail if called on a network where the is no Timer (!controllableTiming).
  const timerAddress = controllableTiming
    ? (await Timer.deployed()).address
    : "0x0000000000000000000000000000000000000000";
  const jarvisTokenFactory = await JarvisTokenFactory.deployed();
  const registry = await Registry.deployed();

  // Deploy PoolPartPerpLibraries and link to PoolPartyPerpCreator.

  // Buidler
  if (FeePayerPoolPartyLib.setAsDeployed) {
    const { contract: feePayerPoolPartyLib } = await deploy(deployer, network, FeePayerPoolPartyLib);

    // Due to how truffle-plugin works, it statefully links it
    // and throws an error if its already linked. So we'll just ignore it...
    try {
      await PerpetualPositionManagerPoolPartyLib.link(feePayerPoolPartyLib);
      await PerpetualLiquidatablePoolPartyLib.link(feePayerPoolPartyLib);
      await PerpetualPoolParty.link(feePayerPoolPartyLib);
      await PerpetualPoolPartyLib.link(feePayerPoolPartyLib);
    } catch (e) {
      // Allow this to fail in the Buidler case.
    }
  } else {
    // Truffle
    await deploy(deployer, network, FeePayerPoolPartyLib);
    await deployer.link(FeePayerPoolPartyLib, [
      PerpetualPositionManagerPoolPartyLib,
      PerpetualLiquidatablePoolPartyLib,
      PerpetualPoolParty,
      PerpetualPoolPartyLib
    ]);
  }

  if (PerpetualPositionManagerPoolPartyLib.setAsDeployed) {
    const { contract: positionManagerPoolPartyLib } = await deploy(
      deployer,
      network,
      PerpetualPositionManagerPoolPartyLib
    );

    // Due to how truffle-plugin works, it statefully links it
    // and throws an error if its already linked. So we'll just ignore it...
    try {
      await PerpetualLiquidatablePoolPartyLib.link(positionManagerPoolPartyLib);
      await PerpetualPoolParty.link(positionManagerPoolPartyLib);
      await PerpetualPoolPartyLib.link(positionManagerPoolPartyLib);
    } catch (e) {
      // Allow this to fail in the Buidler case.
    }
  } else {
    // Truffle
    await deploy(deployer, network, PerpetualPositionManagerPoolPartyLib);
    await deployer.link(PerpetualPositionManagerPoolPartyLib, [
      PerpetualLiquidatablePoolPartyLib,
      PerpetualPoolParty,
      PerpetualPoolPartyLib
    ]);
  }

  if (PerpetualLiquidatablePoolPartyLib.setAsDeployed) {
    const { contract: liquidatablePoolPartyLib } = await deploy(deployer, network, PerpetualLiquidatablePoolPartyLib);

    // Due to how truffle-plugin works, it statefully links it
    // and throws an error if its already linked. So we'll just ignore it...
    try {
      await PerpetualPoolParty.link(liquidatablePoolPartyLib);
      await PerpetualPoolPartyLib.link(liquidatablePoolPartyLib);
    } catch (e) {
      // Allow this to fail in the Buidler case.
    }
  } else {
    // Truffle
    await deploy(deployer, network, PerpetualLiquidatablePoolPartyLib);
    await deployer.link(PerpetualLiquidatablePoolPartyLib, [PerpetualPoolParty, PerpetualPoolPartyLib]);
  }

  if (PerpetualPoolPartyLib.setAsDeployed) {
    const { contract: poolPartyLib } = await deploy(deployer, network, PerpetualPoolPartyLib);

    // Due to how truffle-plugin works, it statefully links it
    // and throws an error if its already linked. So we'll just ignore it...
    try {
      await PerpetualPoolPartyCreator.link(poolPartyLib);
    } catch (e) {
      // Allow this to fail in the Buidler case.
    }
  } else {
    // Truffle
    await deploy(deployer, network, PerpetualPoolPartyLib);
    await deployer.link(PerpetualPoolPartyLib, PerpetualPoolPartyCreator);
  }

  const { contract: perpetualPoolPartyCreator } = await deploy(
    deployer,
    network,
    PerpetualPoolPartyCreator,
    finder.address,
    jarvisTokenFactory.address,
    timerAddress,
    { from: keys.deployer }
  );

  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, perpetualPoolPartyCreator.address);
};
