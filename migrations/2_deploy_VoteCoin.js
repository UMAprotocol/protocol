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
  let storeAddress;
  let priceFeedAddress;
  let registry;
  if (isDerivativeDemo(network)) {
    deployer
      .then(() => {
        return deployer.deploy(Registry);
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return Registry.deployed();
      })
      .then(() => {
        return deployer.deploy(TokenizedDerivativeCreator, registry.address, oracleAddress, priceFeedAddress);
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addContractCreator(tokenizedDerivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(Leveraged2x);
      })
      .then(() => {
        return Leveraged2x.deployed();
      });
  } else if (shouldUseMockOracle(network)) {
    deployer
      .then(() => {
        return deployer.deploy(Registry);
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return Registry.deployed();
      })
      .then(() => {
        return deployer.deploy(ManualPriceFeed, enableControllableTiming(network));
      })
      .then(manualPriceFeed => {
        priceFeedAddress = manualPriceFeed.address;
        return ManualPriceFeed.deployed();
      })
      .then(() => {
        return deployer.deploy(CentralizedOracle, registry.address, enableControllableTiming(network));
      })
      .then(centralizedOracle => {
        oracleAddress = centralizedOracle.address;
        return CentralizedOracle.deployed();
      })
      .then(() => {
        return deployer.deploy(CentralizedStore, enableControllableTiming(network));
      })
      .then(centralizedStore => {
        storeAddress = centralizedStore.address;
        return CentralizedStore.deployed();
      })
      .then(() => {
        return deployer.deploy(DerivativeCreator, registry.address, oracleAddress, storeAddress, priceFeedAddress);
      })
      .then(() => {
        return DerivativeCreator.deployed();
      })
      .then(derivativeCreator => {
        return registry.addDerivativeCreator(derivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(
          TokenizedDerivativeCreator,
          registry.address,
          oracleAddress,
          storeAddress,
          priceFeedAddress
        );
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addDerivativeCreator(tokenizedDerivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(NoLeverage);
      })
      .then(() => {
        return NoLeverage.deployed();
      });
  } else {
    deployer
      .then(() => {
        return deployer.deploy(Registry);
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return Registry.deployed();
      })
      .then(() => {
        return deployer.deploy(DerivativeCreator, registry.address, oracleAddress, priceFeedAddress);
      })
      .then(() => {
        return DerivativeCreator.deployed();
      })
      .then(derivativeCreator => {
        return registry.addDerivativeCreator(derivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(
          TokenizedDerivativeCreator,
          registry.address,
          oracleAddress,
          storeAddress,
          priceFeedAddress
        );
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addDerivativeCreator(tokenizedDerivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(NoLeverage);
      })
      .then(() => {
        return NoLeverage.deployed();
      });
  }
};
