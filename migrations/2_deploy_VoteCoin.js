var OracleMock = artifacts.require("OracleMock");
var Registry = artifacts.require("Registry");
var Vote = artifacts.require("VoteCoin");

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
        return deployer.deploy(Registry, oracleMock.address, { from: accounts[0], value: 0 });
      })
      .then(() => {
        return Registry.deployed();
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
        console.log(oracle.address);
        return deployer.deploy(Registry, oracle.address, { from: accounts[0], value: 0 });
      })
      .then(() => {
        return Registry.deployed();
      });
  }
};
