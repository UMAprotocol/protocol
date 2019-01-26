const CentralizedOracle = artifacts.require("CentralizedOracle");
const CentralizedStore = artifacts.require("CentralizedStore");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const Registry = artifacts.require("Registry");
const DerivativeCreator = artifacts.require("DerivativeCreator");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const Leveraged2x = artifacts.require("Leveraged2x");
const NoLeverage = artifacts.require("NoLeverage");

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
}

module.exports = async function(deployer, network, accounts) {
  const controllableTiming = enableControllableTiming(network);

  // Deploy single-instantiation (singleton) contracts.
  const registry = await deployAndGet(deployer, Registry);
  const centralizedOracle = await deployAndGet(deployer, CentralizedOracle, controllableTiming);
  const manualPriceFeed = await deployAndGet(deployer, ManualPriceFeed, controllableTiming);
  const centralizedStore = await deployAndGet(deployer, CentralizedStore, controllableTiming);

  // Deploy derivative creators.
  const derivativeCreator = await deployAndGet(deployer, 
    DerivativeCreator,
    registry.address,
    centralizedOracle.address,
    centralizedStore.address,
    manualPriceFeed.address
  );
  const tokenizedDerivativeCreator = await deployAndGet(deployer, 
    TokenizedDerivativeCreator,
    registry.address,
    centralizedOracle.address,
    centralizedStore.address,
    manualPriceFeed.address
  );

  // Deploy return calculators.
  // Note: we don't use deployAndGet() here because we don't need the addresses elsewhere.
  await deployer.deploy(NoLeverage);
  await deployer.deploy(Leveraged2x);

  // Add creator contracts to the registry.
  await registry.addDerivativeCreator(derivativeCreator.address);
  await registry.addDerivativeCreator(tokenizedDerivativeCreator.address);
};
