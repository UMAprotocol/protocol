const CentralizedOracle = artifacts.require("CentralizedOracle");
const CentralizedStore = artifacts.require("CentralizedStore");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const Registry = artifacts.require("Registry");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const TokenizedDerivativeUtils = artifacts.require("TokenizedDerivativeUtils");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");
const AddressWhitelist = artifacts.require("AddressWhitelist");

const enableControllableTiming = network => {
  return (
    network === "test" ||
    network === "develop" ||
    network === "development" ||
    network === "ci" ||
    network === "coverage"
  );
};

const deployAndGet = async (deployer, contractType, ...args) => {
  await deployer.deploy(contractType, ...args);
  return await contractType.deployed();
};

module.exports = async function(deployer, network, accounts) {
  const controllableTiming = enableControllableTiming(network);

  // Deploy single-instantiation (singleton) contracts.
  const registry = await deployAndGet(deployer, Registry);
  const centralizedOracle = await deployAndGet(deployer, CentralizedOracle, registry.address, controllableTiming);
  const manualPriceFeed = await deployAndGet(deployer, ManualPriceFeed, controllableTiming);
  const centralizedStore = await deployAndGet(deployer, CentralizedStore, controllableTiming);
  const returnCalculator = await deployAndGet(deployer, LeveragedReturnCalculator, 1);

  // Deploy sponsor whitelist and add second account to it.
  const sponsorWhitelist = await deployAndGet(deployer, AddressWhitelist);
  await sponsorWhitelist.addToWhitelist(accounts[1]);

  // Deploy return calculator whitelist and add the 1x return calculator to it.
  const returnCalculatorWhitelist = await deployAndGet(deployer, AddressWhitelist);
  await returnCalculatorWhitelist.addToWhitelist(returnCalculator.address);

  // Deploy margin currency whitelist and add ETH to it.
  const marginCurrencyWhitelist = await deployAndGet(deployer, AddressWhitelist);
  await marginCurrencyWhitelist.addToWhitelist("0x0000000000000000000000000000000000000000");

  // TokenizedDerivativeCreator requires the TokenizedDerivativeUtils library to be deployed first.
  await deployer.deploy(TokenizedDerivativeUtils);
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
    controllableTiming
  );

  // Add creator contract to the registry.
  await registry.addDerivativeCreator(tokenizedDerivativeCreator.address);

  // Add supported price feeds to the Oracle.
  const supportedIdentifiers = ["SPY/USD", "CNH/USD", "BTC/ETH"];
  for (let identifier of supportedIdentifiers) {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(identifier));
    await centralizedOracle.addSupportedIdentifier(identifierBytes);
  }
};
