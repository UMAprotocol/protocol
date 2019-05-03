const CentralizedOracle = artifacts.require("CentralizedOracle");
const Registry = artifacts.require("Registry");

async function getDeployAddress() {
  const accounts = await web3.eth.getAccounts();
  return accounts[0];
}

async function registerDerivative(registryAddress) {
  const deployAddress = await getDeployAddress();

  const registry = await Registry.at(registryAddress);
  await registry.addDerivativeCreator(deployAddress);
  console.log("Creator Added:", deployAddress);
  if (!(await registry.isDerivativeRegistered(deployAddress))) {
    await registry.registerDerivative([], deployAddress);
    console.log("Registered derivative:", deployAddress);
  }
}

// Note: This script initiates a price request to CentralizedOracle.
// Its primary purpose is test setup for `scripts/PushOraclePrice.js`
// This script executes the following steps:
//   1. Registers the migration deployer's address as a Derivative Creator.
//   2. Registers the deployer's address as a derivative.
//   3. Adds the specified identifier with the CentralizedOracle.
//   4. Requests a price at the specified time.
async function run(registryAddress, oracleAddress, identifier, timeInSeconds) {
  try {
    await registerDerivative(registryAddress);

    const identifierInBytes = web3.utils.fromAscii(identifier);
    const timeInBN = web3.utils.toBN(timeInSeconds);
    const time = new Date(timeInSeconds * 10e2);

    const oracle = await CentralizedOracle.at(oracleAddress);
    await oracle.addSupportedIdentifier(identifierInBytes);
    const result = await oracle.requestPrice.call(identifierInBytes, timeInBN);
    if (result == 0) {
      console.log(`Price already exists for ${identifier} @ ${time}`);
      return;
    }

    await oracle.requestPrice(identifierInBytes, timeInBN);
    console.log(`Price requested for ${identifier} @ ${time}`);
  } catch (err) {
    console.error(err);
    return;
  }
}

const runRequestOraclePrice = async function(callback) {
  // Usage: truffle exec scripts/RequestOraclePrice.js <Registry address> <CentralizedOracle address> <identifier> <time> --network <network>
  // where <time> is seconds since January 1st, 1970 00:00:00 UTC.
  if (process.argv.length < 8) {
    console.error(
      "Not enough arguments. Must include <Registry address>, <CentralizedOracle address>, <identifier>, and <time>"
    );
    return;
  }

  const registryAddress = process.argv[4];
  if (registryAddress.substring(0, 2) != "0x" || registryAddress.length != 42) {
    console.error("Registry's contract address missing. Exiting...");
    return;
  }

  const oracleAddress = process.argv[5];
  if (oracleAddress.substring(0, 2) != "0x" || oracleAddress.length != 42) {
    console.error("CentralizedOracle's contract address missing. Exiting...");
    return;
  }

  const identifier = process.argv[6];
  const timeInSeconds = parseInt(process.argv[7], 10);

  await run(registryAddress, oracleAddress, identifier, timeInSeconds);
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
runRequestOraclePrice.run = run;
module.exports = runRequestOraclePrice;
