const tdr = require("truffle-deploy-registry");

// Determines whether the network requires timestamps to be manually controlled or not.
function enableControllableTiming(network) {
  return (
    network === "test" ||
    network === "develop" ||
    network === "development" ||
    network === "ci" ||
    network === "coverage"
  );
}

function shouldCommitDeployment(network) {
  return (
    network === "ci" || // Just for testing the process of saving deployments.
    network.startsWith("ropsten") ||
    network.startsWith("mainnet")
  );
}

// Helper function to deploy a contract and get the result.
async function deployAndGet(deployer, contractType, ...args) {
  await deployer.deploy(contractType, ...args);
  return await contractType.deployed();
}

// Maps key ordering to key names.
function getKeysForNetwork(network, accounts) {
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
}

async function addToTdr(instance, network) {
  // Probably redundant checks, but useful in case of future modifications.
  if (!tdr.isDryRunNetworkName(network) && shouldCommitDeployment(network)) {
    await tdr.appendInstance(instance);
  }
}

module.exports = {
  enableControllableTiming,
  deployAndGet,
  getKeysForNetwork,
  addToTdr
};
