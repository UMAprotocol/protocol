const Finder = artifacts.require("Finder");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const TokenizedDerivativeUtils = artifacts.require("TokenizedDerivativeUtils");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const { getKeysForNetwork, deploy, enableControllableTiming, addToTdr } = require("../../common/MigrationUtils.js");

const ethAddress = "0x0000000000000000000000000000000000000000";

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // Deploy whitelists.
  const { contract: returnCalculatorWhitelist } = await deploy(deployer, network, AddressWhitelist, {
    from: keys.returnCalculatorWhitelist
  });
  const { contract: marginCurrencyWhitelist } = await deploy(deployer, network, AddressWhitelist, {
    from: keys.marginCurrencyWhitelist
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

  // Add the return calculator to the whitelist.
  const returnCalculator = await LeveragedReturnCalculator.deployed();
  await returnCalculatorWhitelist.addToWhitelist(returnCalculator.address, { from: keys.returnCalculatorWhitelist });

  if (!network.startsWith("mainnet") && !network.startsWith("ropsten")) {
    await marginCurrencyWhitelist.addToWhitelist(ethAddress, { from: keys.marginCurrencyWhitelist });
  }
};
