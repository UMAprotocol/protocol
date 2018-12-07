var OracleMock = artifacts.require("OracleMock");
var Registry = artifacts.require("Registry");
var Vote = artifacts.require("VoteCoin");
var DerivativeCreator = artifacts.require("DerivativeCreator");
var TokenizedDerivativeCreator = artifacts.require("TokenizedDerivativeCreator");

var enableControllableTiming = network => {
  return (
    network === "test" ||
    network === "develop" ||
    network === "development" ||
    network === "ci" ||
    network === "coverage" ||
    network === "app"
  );
};

var shouldUseMockOracle = network => {
  return network === "test" || network === "ci" || network === "coverage";
};

module.exports = function(deployer, network, accounts) {
  var oracleAddress;
  var registry;
  if (shouldUseMockOracle(network)) {
    deployer
      .then(() => {
        return deployer.deploy(Vote, "BTC/USD", "86400", enableControllableTiming(network), {
          from: accounts[0],
          value: 0
        });
      })
      .then(() => {
        return deployer.deploy(OracleMock, { from: accounts[0], value: 0 });
      })
      .then(() => {
        return OracleMock.deployed();
      })
      .then(oracleMock => {
        oracleAddress = oracleMock.address;
        return deployer.deploy(Registry, oracleAddress, { from: accounts[0], value: 0 });
      })
      .then(() => {
        return Registry.deployed();
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return deployer.deploy(DerivativeCreator, registry.address, oracleAddress);
      })
      .then(() => {
        return DerivativeCreator.deployed();
      })
      .then(derivativeCreator => {
        return registry.addContractCreator(derivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(TokenizedDerivativeCreator, registry.address, oracleAddress);
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addContractCreator(tokenizedDerivativeCreator.address);
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
      .then(oracle => {
        oracleAddress = oracle.address;
        return deployer.deploy(Registry, oracleAddress, { from: accounts[0], value: 0 });
      })
      .then(() => {
        return Registry.deployed();
      })
      .then(deployedRegistry => {
        registry = deployedRegistry;
        return deployer.deploy(DerivativeCreator, registry.address, oracleAddress);
      })
      .then(() => {
        return DerivativeCreator.deployed();
      })
      .then(derivativeCreator => {
        return registry.addContractCreator(derivativeCreator.address);
      })
      .then(() => {
        return deployer.deploy(TokenizedDerivativeCreator, registry.address, oracleAddress);
      })
      .then(() => {
        return TokenizedDerivativeCreator.deployed();
      })
      .then(tokenizedDerivativeCreator => {
        return registry.addContractCreator(tokenizedDerivativeCreator.address);
      });
  }
};
