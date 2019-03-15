// Note: for ropsten and mainnet deploys, the command should look as follows:
// $(npm bin)/truffle migrate --reset --network <ropsten_or_mainnet> \
// --keys={deployer,registry,store,priceFeed,sponsorWhitelist,returnCalculatorWhitelist,marginCurrencyWhitelist}

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

const getKeysForNetwork = (network, accounts) => {
  if (network === "ropsten" || network === "mainnet") {
    return {
      deployer: accounts[0],
      registry: accounts[1],
      store: accounts[2],
      priceFeed: accounts[3],
      sponsorWhitelist: accounts[4],
      returnCalculatorWhitelist: accounts[5],
      marginCurrencyWhitelist: accounts[6]
    };
  } else {
    return {
      deployer: accounts[0],
      registry: accounts[0],
      store: accounts[0],
      priceFeed: accounts[0],
      sponsorWhitelist: accounts[0],
      returnCalculatorWhitelist: accounts[0],
      marginCurrencyWhitelist: accounts[0]
    };
  }
};

module.exports = async function(deployer, network, accounts) {
  const controllableTiming = enableControllableTiming(network);
  const keys = getKeysForNetwork(network, accounts);

  // Deploy single-instantiation (singleton) contracts.
  const registry = await deployAndGet(deployer, Registry, { from: keys.registry });

  // TODO: possibly update the oracle owner once we integrate hardware wallets.
  const centralizedOracle = await deployAndGet(deployer, CentralizedOracle, registry.address, controllableTiming, {
    from: keys.deployer
  });
  const manualPriceFeed = await deployAndGet(deployer, ManualPriceFeed, controllableTiming, { from: keys.priceFeed });
  const centralizedStore = await deployAndGet(deployer, CentralizedStore, { from: keys.store });
  const returnCalculator = await deployAndGet(deployer, LeveragedReturnCalculator, 1, { from: keys.deployer });

  // Deploy sponsor whitelist and add second account to it.
  const sponsorWhitelist = await deployAndGet(deployer, AddressWhitelist, { from: keys.sponsorWhitelist });
  await sponsorWhitelist.addToWhitelist(accounts[1], { from: keys.sponsorWhitelist });

  // Deploy return calculator whitelist and add the 1x return calculator to it.
  const returnCalculatorWhitelist = await deployAndGet(deployer, AddressWhitelist, {
    from: keys.returnCalculatorWhitelist
  });
  await returnCalculatorWhitelist.addToWhitelist(returnCalculator.address, { from: keys.returnCalculatorWhitelist });

  // Deploy margin currency whitelist.
  const marginCurrencyWhitelist = await deployAndGet(deployer, AddressWhitelist, {
    from: keys.marginCurrencyWhitelist
  });

  // TokenizedDerivativeCreator requires the TokenizedDerivativeUtils library to be deployed first.
  await deployer.deploy(TokenizedDerivativeUtils, { from: keys.deployer });
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

  // Add creator contract to the registry.
  await registry.addDerivativeCreator(tokenizedDerivativeCreator.address, { from: keys.registry });

  // Add supported identifiers to the Oracle.
  const supportedIdentifiers = ["ESM19", "CBN19"];
  for (let identifier of supportedIdentifiers) {
    const identifierBytes = web3.utils.hexToBytes(web3.utils.utf8ToHex(identifier));
    await centralizedOracle.addSupportedIdentifier(identifierBytes, { from: keys.deployer });
  }

  // Set oracle fees to 0.5% per year.
  const annualFee = web3.utils.toWei("0.005");
  const secondsPerYear = 31536000;
  const feePerSecond = web3.utils.toBN(annualFee).divn(secondsPerYear);
  await centralizedStore.setFixedOracleFeePerSecond(feePerSecond.toString(), { from: keys.store });
};
