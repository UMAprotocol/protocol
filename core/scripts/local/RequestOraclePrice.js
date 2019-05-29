const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "time"] });

const Finder = artifacts.require("Finder");
const Voting = artifacts.require("Voting");
const Registry = artifacts.require("Registry");
const { interfaceName } = require("../../utils/Constants.js");
const { RegistryRolesEnum } = require("../../utils/Enums.js");

async function getDeployAddress() {
  const accounts = await web3.eth.getAccounts();
  return accounts[0];
}

async function registerDerivative(registry) {
  const deployAddress = await getDeployAddress();

  await registry.addMember(RegistryRolesEnum.DERIVATIVE_CREATOR, deployAddress);
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
//   3. Adds the specified identifier with Voting.
//   4. Requests a price at the specified time.
async function run(deployedFinder, identifier, timeInSeconds) {
  try {
    const deployedRegistry = await Registry.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Registry))
    );
    await registerDerivative(deployedRegistry);

    const identifierInBytes = web3.utils.fromAscii(identifier);
    const timeInBN = web3.utils.toBN(timeInSeconds);
    const time = new Date(timeInSeconds * 10e2);

    const deployedVoting = await Voting.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    );
    await deployedVoting.addSupportedIdentifier(identifierInBytes);
    const result = await deployedVoting.requestPrice.call(identifierInBytes, timeInBN);
    if (result == 0) {
      console.log(`Price already exists for ${identifier} @ ${time}`);
      return;
    }

    await deployedVoting.requestPrice(identifierInBytes, timeInBN);
    console.log(`Price requested for ${identifier} @ ${time}`);
  } catch (err) {
    console.error(err);
    return;
  }
}

const runRequestOraclePrice = async function(callback) {
  // Usage: truffle exec scripts/RequestOraclePrice.js --identifier <identifier> --time <time> --network <network>
  // where <time> is seconds since January 1st, 1970 00:00:00 UTC.
  if (!argv.identifier) {
    callback("Must include <identifier>");
  }

  if (!argv.time) {
    callback("Must include <time>");
  }

  const finder = await Finder.deployed();
  await run(finder, argv.identifier, argv.time);
  callback();
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
runRequestOraclePrice.run = run;
module.exports = runRequestOraclePrice;
