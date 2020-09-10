const truffleContract = require("@truffle/contract");
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { getWeb3 } = require("@umaprotocol/common");

/**
 * @notice Gets the truffle artifact for an UMA contract.
 * @param {String} contractName Name of the UMA contract whose artifact object will be returned.
 */
function getArtifact(contractName) {
  const filePath = path.join(__dirname, "build", "contracts", `${contractName}.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath));
}

/**
 * @notice Gets the abi for an UMA contract.
 * @param {String} contractName Name of the UMA contract whose abi will be returned.
 */
function getAbi(contractName) {
  const artifact = getArtifact(contractName);
  return (artifact && artifact.abi) || null;
}

/**
 * @notice Gets the deployed address for an UMA contract.
 * @param {String} contractName Name of the UMA contract whose address will be returned.
 * @param {Integer} networkId Network ID of the network where that contract is deployed.
 */
function getAddress(contractName, networkId) {
  const artifact = getArtifact(contractName);
  return (artifact && artifact.networks[networkId] && artifact.networks[networkId].address) || null;
}

/**
 * @notice Creates a new truffle contract instance based on an existing web3 instance (using its provider).
 * If a web3 instance is not provided, this function will use getWeb3() to attempt to create one.
 * @param {String} contractName Name of the UMA contract to be instantiated.
 * @param {Object} [web3] Custom web3 instance whose provider should be injected into the truffle contract.
 */
function getTruffleContract(contractName, web3) {
  // If there is no web3, use getWeb3() to retrieve one.
  const resolvedWeb3 = web3 || getWeb3();

  const artifact = getArtifact(contractName);

  if (!artifact) {
    return null;
  }

  const Contract = truffleContract(artifact);
  Contract.setProvider(resolvedWeb3.currentProvider);
  return Contract;
}

/**
 * @notice Creates a new truffle contract instance using artifacts. This method will automatically be exported instead
 * of the above method in the case that this is being used in a truffle test context.
 * @param {String} contractName Name of the UMA contract to be instantiated.
 */
function getTruffleContractTest(contractName) {
  try {
    return global.artifacts.require(contractName);
  } catch (error) {
    return null;
  }
}

/**
 * @notice Gets the contract address. This method will automatically be exported instead of getAdress in the case that
 * this is being used in a truffle test context.
 * @param {String} contractName Name of the UMA contract whose address is to be retrieved.
 */
function getAddressTest(contractName, networkId) {
  const truffleContract = getTruffleContractTest(contractName);

  if (!truffleContract) {
    return null;
  }

  if (truffleContract.networks[networkId]) {
    return truffleContract.networks[networkId].address;
  } else if (global.artifacts._provisioner && global.artifacts._provisioner._deploymentAddresses[contractName]) {
    // In the buidler case, there is no networks object, so we fall back to buidler's global list of deployed addresses.
    // Note: this is a bit hacky as it doesn't take into account the user-specified networkId.
    return global.artifacts._provisioner._deploymentAddresses[contractName];
  } else {
    return null;
  }
}

/**
 * @notice Gets the contract abi. This method will automatically be exported instead of getAbi() in the case that
 * this is being used in a truffle test context.
 * @param {String} contractName Name of the UMA contract whose abi is to be retrieved.
 */
function getAbiTest(contractName) {
  const truffleContract = getTruffleContractTest(contractName);
  return (truffleContract && truffleContract.abi) || null;
}

if (global.artifacts) {
  module.exports = {
    getAbi: getAbiTest,
    getAddress: getAddressTest,
    getTruffleContract: getTruffleContractTest
  };
} else {
  module.exports = {
    getAbi,
    getAddress,
    getTruffleContract
  };
}
