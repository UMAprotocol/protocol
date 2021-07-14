const Finder = artifacts.require("Finder");
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const ExpiringMultiPartyLib = artifacts.require("ExpiringMultiPartyLib");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const Timer = artifacts.require("Timer");
const Registry = artifacts.require("Registry");
const TestnetERC20 = artifacts.require("TestnetERC20");
const {
  RegistryRolesEnum,
  interfaceName,
  getKeysForNetwork,
  deploy,
  enableControllableTiming,
} = require("@uma/common");

module.exports = async function (deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // Deploy CollateralWhitelist.
  const { contract: collateralWhitelist } = await deploy(deployer, network, AddressWhitelist, { from: keys.deployer });

  // Add CollateralWhitelist to finder.
  const finder = await Finder.deployed();
  await finder.changeImplementationAddress(
    web3.utils.utf8ToHex(interfaceName.CollateralWhitelist),
    collateralWhitelist.address,
    { from: keys.deployer }
  );

  // Add the testnet ERC20 as the default collateral currency (this is the DAI address on mainnet).
  const testnetERC20 = await TestnetERC20.deployed();
  await collateralWhitelist.addToWhitelist(testnetERC20.address);

  // .deployed() will fail if called on a network where the is no Timer (!controllableTiming).
  const timerAddress = controllableTiming
    ? (await Timer.deployed()).address
    : "0x0000000000000000000000000000000000000000";
  const tokenFactory = await TokenFactory.deployed();
  const registry = await Registry.deployed();

  // Deploy EMPLib and link to EMPCreator.

  // hardhat
  if (ExpiringMultiPartyLib.setAsDeployed) {
    const { contract: empLib } = await deploy(deployer, network, ExpiringMultiPartyLib);

    // Due to how truffle-plugin works, it statefully links it
    // and throws an error if its already linked. So we'll just ignore it...
    try {
      await ExpiringMultiPartyCreator.link(empLib);
    } catch (e) {
      // Allow this to fail in the hardhat case.
    }
  } else {
    // Truffle
    await deploy(deployer, network, ExpiringMultiPartyLib);
    await deployer.link(ExpiringMultiPartyLib, ExpiringMultiPartyCreator);
  }

  const { contract: expiringMultiPartyCreator } = await deploy(
    deployer,
    network,
    ExpiringMultiPartyCreator,
    finder.address,
    tokenFactory.address,
    timerAddress,
    { from: keys.deployer }
  );

  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address);
};
