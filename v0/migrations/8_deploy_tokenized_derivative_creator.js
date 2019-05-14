const CentralizedOracle = artifacts.require("CentralizedOracle");
const CentralizedStore = artifacts.require("CentralizedStore");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const Registry = artifacts.require("Registry");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const TokenizedDerivativeUtils = artifacts.require("TokenizedDerivativeUtils");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const AddressWhitelist = artifacts.require("AddressWhitelist");
const {
  getKeysForNetwork,
  deployAndGet,
  enableControllableTiming,
  addToTdr
} = require("../../common/MigrationUtils.js");

module.exports = async function(deployer, network, accounts) {
  const keys = getKeysForNetwork(network, accounts);
  const controllableTiming = enableControllableTiming(network);

  // Deploy whitelists.
  const sponsorWhitelist = await deployAndGet(deployer, AddressWhitelist, { from: keys.sponsorWhitelist });
  const returnCalculatorWhitelist = await deployAndGet(deployer, AddressWhitelist, {
    from: keys.returnCalculatorWhitelist
  });
  const marginCurrencyWhitelist = await deployAndGet(deployer, AddressWhitelist, {
    from: keys.marginCurrencyWhitelist
  });

  const manualPriceFeed = await ManualPriceFeed.deployed();
  const centralizedOracle = await CentralizedOracle.deployed();
  const centralizedStore = await CentralizedStore.deployed();
  const registry = await Registry.deployed();

  // Link and deploy creator.
  await deployer.link(TokenizedDerivativeUtils, TokenizedDerivativeCreator);
  const tokenizedDerivativeCreator = await deployAndGet(
    deployer,
    TokenizedDerivativeCreator,
    registry.address,
    centralizedOracle.address,
    centralizedStore.address,
    manualPriceFeed.address,
    sponsorWhitelist.address,
    returnCalculatorWhitelist.address,
    marginCurrencyWhitelist.address,
    controllableTiming,
    { from: keys.deployer }
  );
  await addToTdr(tokenizedDerivativeCreator, network);

  // Add the return calculator to the whitelist.
  const returnCalculator = await LeveragedReturnCalculator.deployed();
  await returnCalculatorWhitelist.addToWhitelist(returnCalculator.address, { from: keys.returnCalculatorWhitelist });

  if (!network.startsWith("mainnet") && !network.startsWith("ropsten")) {
    await sponsorWhitelist.addToWhitelist(accounts[1], { from: keys.sponsorWhitelist });
    const ethAddress = "0x0000000000000000000000000000000000000000";
    await marginCurrencyWhitelist.addToWhitelist(ethAddress, { from: keys.marginCurrencyWhitelist });
  }
};
