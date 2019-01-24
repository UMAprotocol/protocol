const CentralizedOracle = artifacts.require("CentralizedOracle");
const CentralizedStore = artifacts.require("CentralizedStore");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const Registry = artifacts.require("Registry");
const DerivativeCreator = artifacts.require("DerivativeCreator");
const TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");
const LeveragedReturnCalculator = artifacts.require("LeveragedReturnCalculator");

const enableControllableTiming = network => {
  return (
    network === "test" ||
    network === "develop" ||
    network === "development" ||
    network === "ci" ||
    network === "coverage" ||
    network === "app"
  );
};

const isDerivativeDemo = network => {
  return network == "derivative_demo" || network == "derivative_demo_ropsten" || network == "derivative_demo_mainnet";
};

const shouldUseMockOracle = network => {
  return (
    network === "test" ||
    network === "ci" ||
    network === "coverage" ||
    network == "derivative_demo" ||
    network == "derivative_demo_ropsten" ||
    network == "derivative_demo_mainnet"
  );
};

module.exports = function(deployer, network, accounts) {
  let oracleAddress;
  let priceFeedAddress;
  let registry;
  if (isDerivativeDemo(network)) {
    deployer
      .then(() => {
        return Registry.deployed();
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return deployer.deploy(TokenizedDerivativeCreator, registry.address, oracleAddress, priceFeedAddress, {
          from: accounts[0],
          value: 0
        });
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addContractCreator(tokenizedDerivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(LeveragedReturnCalculator, 2);
      })
      .then(() => {
        return LeveragedReturnCalculator.deployed();
      });
  } else if (shouldUseMockOracle(network)) {
    deployer
      .then(() => {
        return deployer.deploy(ManualPriceFeed, enableControllableTiming(network));
      })
      .then(manualPriceFeed => {
        priceFeedAddress = manualPriceFeed.address;
        return ManualPriceFeed.deployed();
      })
      .then(() => {
        return deployer.deploy(CentralizedOracle, enableControllableTiming(network));
      })
      .then(centralizedOracle => {
        oracleAddress = centralizedOracle.address;
        return CentralizedOracle.deployed();
      })
      .then(() => {
        return deployer.deploy(Registry, oracleAddress, { from: accounts[0], value: 0 });
      })
      .then(() => {
        return Registry.deployed();
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return deployer.deploy(DerivativeCreator, registry.address, oracleAddress, priceFeedAddress);
      })
      .then(() => {
        return DerivativeCreator.deployed();
      })
      .then(derivativeCreator => {
        return registry.addDerivativeCreator(derivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(TokenizedDerivativeCreator, registry.address, oracleAddress, priceFeedAddress);
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addDerivativeCreator(tokenizedDerivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(LeveragedReturnCalculator, 1);
      })
      .then(() => {
        return LeveragedReturnCalculator.deployed();
      })
      .then(() => {
        return deployer.deploy(CentralizedStore);
      })
      .then(() => {
        return CentralizedStore.deployed();
      });
  } else {
    deployer
      .then(() => {
        return Registry.deployed();
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return deployer.deploy(DerivativeCreator, registry.address, oracleAddress, priceFeedAddress);
      })
      .then(() => {
        return DerivativeCreator.deployed();
      })
      .then(derivativeCreator => {
        return registry.addDerivativeCreator(derivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(TokenizedDerivativeCreator, registry.address, oracleAddress, priceFeedAddress);
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addDerivativeCreator(tokenizedDerivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(LeveragedReturnCalculator, 1);
      })
      .then(() => {
        return LeveragedReturnCalculator.deployed();
      });
  }
};
