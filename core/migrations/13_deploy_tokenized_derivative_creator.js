const Finder = artifacts.require("Finder");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const TokenizedDerivativeUtils = artifacts.require("TokenizedDerivativeUtils");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const { getKeysForNetwork, deploy, enableControllableTiming } = require("../../common/MigrationUtils.js");

const ethAddress = "0x0000000000000000000000000000000000000000";

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // Deploy whitelists.
  const { contract: returnCalculatorWhitelist } = await deploy(deployer, network, AddressWhitelist, {
    from: keys.deployer
  });
  const { contract: marginCurrencyWhitelist } = await deploy(deployer, network, AddressWhitelist, {
    from: keys.deployer
  });

  const finder = await Finder.deployed();

  // Link and deploy creator.
  await deployer.link(TokenizedDerivativeUtils, TokenizedDerivativeCreator);
  await deploy(
    deployer,
    network,
    TokenizedDerivativeCreator,
    finder.address,
    returnCalculatorWhitelist.address,
    marginCurrencyWhitelist.address,
    controllableTiming,
    { from: keys.deployer }
  );

  // For any test networks, automatically add ETH as an allowed margin currency.
  await marginCurrencyWhitelist.addToWhitelist(ethAddress, { from: keys.deployer });
};
