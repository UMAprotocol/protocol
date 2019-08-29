const tdr = require("truffle-deploy-registry");

// To prevent a call to migrate --reset from overwriting prevously deployed contract instances, use the following
// command line parameters:
// --keep_finder prevents the Finder contract from being redeployed if previously deployed.
// --keep_token prevents the VotingToken contract from being redeployed if previously deployed.
// --keep_system keeps all contracts not covered by the other arguments from being replaced.
// Note: to keep all contracts intact (essentially a no-op), one would need to provide all the above arguments.
const argv = require("minimist")(process.argv.slice(), { boolean: ["keep_finder", "keep_token", "keep_system"] });

// Grab the name property from each to get a list of the names of the public networks.
const publicNetworkNames = Object.values(require("./PublicNetworks.js")).map(elt => elt.name);

function isPublicNetwork(network) {
  return publicNetworkNames.some(name => network.startsWith(name));
}

// Determines whether the network requires timestamps to be manually controlled or not.
function enableControllableTiming(network) {
  // Any non public network should have controllable timing.
  return !isPublicNetwork(network);
}

function shouldCommitDeployment(network) {
  // ci is included here just for testing the process of saving deployments.
  return network === "ci" || isPublicNetwork(network);
}

function isEmptyObject(obj) {
  return Object.entries(obj).length === 0 && obj.constructor === Object;
}

// Extracts the transaction options from a transaction arg list. If the arg list doesn't have a transaction options
// element, then it creates one and returns it.
function getTxnOptions(argList) {
  const emptyTxnOptions = {};
  if (argList.length === 0) {
    // No arguments, so add and return the empty txn options object.
    argList.push(emptyTxnOptions);
    return emptyTxnOptions;
  } else {
    // Determine if the last element is the txn options object.
    const lastElement = argList[argList.length - 1];

    if (
      lastElement.from === undefined &&
      lastElement.gas === undefined &&
      lastElement.gasPrice === undefined &&
      lastElement.value === undefined &&
      !isEmptyObject(lastElement)
    ) {
      // The last element is not the txn options object, so use the empty options defined at the top.
      argList.push(emptyTxnOptions);
      return emptyTxnOptions;
    } else {
      // The last element is the txn options element, so return it.
      return lastElement;
    }
  }
}

// Deploys a contract (if the CLI options allow) and adds it to the committed contract registry.
async function deploy(deployer, network, contractType, ...args) {
  // Extract the txn options element from the contract arguments.
  const txnOptions = getTxnOptions(args);

  // Each portion of the system can have its overwrite varied independently.
  switch (contractType.contractName) {
    case "Finder":
      txnOptions.overwrite = !argv.keep_finder;
      break;
    case "VotingToken":
      txnOptions.overwrite = !argv.keep_token;
      break;
    case "Migrations":
      // Always redeploy the Migrations contract.
      txnOptions.overwrite = true;
      break;
    default:
      txnOptions.overwrite = !argv.keep_system;
      break;
  }

  // If the contract will be overwritten or it is not yet deployed, a new one will be deployed.
  const willDeploy = txnOptions.overwrite || !contractType.isDeployed();

  // Deploy contract.
  await deployer.deploy(contractType, ...args);
  const contractInstance = await contractType.deployed();

  // Add to the registry.
  await addToTdr(contractInstance, network);

  // Return relevant info about the contract.
  return {
    contract: await contractType.deployed(),
    didDeploy: willDeploy
  };
}

async function setToExistingAddress(network, contractType, address) {
  // Set the contract address locally, which will be reflected in the truffle artifacts.
  contractType.address = address;

  // Get a contract instance to pass to tdr.
  const instance = await contractType.at(address);

  // Add to the registry.
  await addToTdr(instance, network);

  return instance;
}

// Maps key ordering to key names.
function getKeysForNetwork(network, accounts) {
  // Must be exactly equal to a public network name to exclude the _mnemonic network configurations that don't use
  // gcloud key encryption.
  if (publicNetworkNames.some(name => name === network)) {
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
  deploy,
  setToExistingAddress,
  getKeysForNetwork,
  addToTdr,
  isPublicNetwork
};
