const CentralizedOracle = artifacts.require("CentralizedOracle");
const ManualPriceFeed = artifacts.require("ManualPriceFeed");
const Registry = artifacts.require("Registry");
const Vote = artifacts.require("VoteCoin");
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
  let v2OracleAddress;
  let priceFeedAddress;
  let registry;
  if (isDerivativeDemo(network)) {
    deployer
      .then(() => {
        return Registry.deployed();
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return deployer.deploy(TokenizedDerivativeCreator, registry.address, v2OracleAddress, priceFeedAddress, {
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
        return deployer.deploy(Leveraged2x);
      })
      .then(() => {
        return Leveraged2x.deployed();
      });
  } else if (shouldUseMockOracle(network)) {
    deployer
      .then(() => {
        return deployer.deploy(Vote, "BTC/USD", "86400", enableControllableTiming(network), {
          from: accounts[0],
          value: 0
        });
      })
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
        v2OracleAddress = centralizedOracle.address;
        return CentralizedOracle.deployed();
      })
      .then(() => {
        return Registry.deployed();
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return deployer.deploy(DerivativeCreator, registry.address, v2OracleAddress, priceFeedAddress);
      })
      .then(() => {
        return DerivativeCreator.deployed();
      })
      .then(derivativeCreator => {
        return registry.addContractCreator(derivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(TokenizedDerivativeCreator, registry.address, v2OracleAddress, priceFeedAddress);
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addContractCreator(tokenizedDerivativeCreator.address);
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
        return deployer.deploy(Vote, "BTC/USD", "86400", enableControllableTiming(network), {
          from: accounts[0],
          value: 0
        });
      })
      .then(() => {
        return Vote.deployed();
      })
      .then(() => {
        return Registry.deployed();
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return deployer.deploy(DerivativeCreator, registry.address, v2OracleAddress, priceFeedAddress);
      })
      .then(() => {
        return DerivativeCreator.deployed();
      })
      .then(derivativeCreator => {
        return registry.addContractCreator(derivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(TokenizedDerivativeCreator, registry.address, v2OracleAddress, priceFeedAddress);
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addContractCreator(tokenizedDerivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(NoLeverage);
      })
      .then(() => {
        return NoLeverage.deployed();
      });
  }
};
