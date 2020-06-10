const Finder = artifacts.require("Finder");
const ExpiringMultiPartyCreator = artifacts.require("ExpiringMultiPartyCreator");
const ExpiringMultiPartyLib = artifacts.require("ExpiringMultiPartyLib");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const TokenFactory = artifacts.require("TokenFactory");
const { getKeysForNetwork, deploy, enableControllableTiming } = require("../../common/MigrationUtils.js");
const Timer = artifacts.require("Timer");
const Registry = artifacts.require("Registry");
const TestnetERC20 = artifacts.require("TestnetERC20");
const { RegistryRolesEnum } = require("../../common/Enums.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // Deploy whitelists.
  const { contract: collateralCurrencyWhitelist } = await deploy(deployer, network, AddressWhitelist, {
    from: keys.deployer
  });

  await collateralCurrencyWhitelist.addToWhitelist(TestnetERC20.address);
  const finder = await Finder.deployed();
  const tokenFactory = await TokenFactory.deployed();
  const registry = await Registry.deployed();

  // Deploy EMPLib and link to EMPCreator.
  await deploy(deployer, network, ExpiringMultiPartyLib);
  await deployer.link(ExpiringMultiPartyLib, ExpiringMultiPartyCreator);

  const { contract: expiringMultiPartyCreator } = await deploy(
    deployer,
    network,
    ExpiringMultiPartyCreator,
    finder.address,
    collateralCurrencyWhitelist.address,
    tokenFactory.address,
    controllableTiming ? Timer.address : "0x0000000000000000000000000000000000000000",
    { from: keys.deployer }
  );

  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, expiringMultiPartyCreator.address);
};
