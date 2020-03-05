const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "time"] });

const Finder = artifacts.require("Finder");
const Voting = artifacts.require("Voting");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Registry = artifacts.require("Registry");
const { interfaceName } = require("../../utils/Constants.js");
const { triggerOnRequest } = require("../../utils/Serving.js");
const { RegistryRolesEnum } = require("../../../common/Enums.js");

async function getDeployAddress() {
  const accounts = await web3.eth.getAccounts();
  return accounts[0];
}

async function registerContract(registry) {
  const deployAddress = await getDeployAddress();

  if (!(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, deployAddress))) {
    // Wrapping with an if isn't strictly necessary, but saves gas when script is used regularly.
    await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployAddress);
    console.log("Creator Added:", deployAddress);
  }

  if (!(await registry.isContractRegistered(deployAddress))) {
    await registry.registerContract([], deployAddress);
    console.log("Registered contract:", deployAddress);
  }
}

// Note: This script initiates a price request to the Voting contract.
// Its primary purpose is test setup for `scripts/PushOraclePrice.js`
// This script executes the following steps:
//   1. Registers the migration deployer's address as a Derivative Creator.
//   2. Registers the deployer's address as a derivative.
//   3. Adds the specified identifier with Voting.
//   4. Requests a price at the specified time.
async function run(deployedFinder, identifier, timeString) {
  try {
    const deployedRegistry = await Registry.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Registry))
    );
    await registerContract(deployedRegistry);

    const identifierInBytes = web3.utils.fromAscii(identifier);

    let timeInSeconds = parseInt(timeString);
    if (timeInSeconds === 0) {
      // If time input is 0, use current time (less 2 minutes to ensure we don't jump in front of the block timestamp).
      timeInSeconds = Math.floor(new Date().getTime() / 10e2) - 120;
      console.log(`User provided timestamp of 0, using current timestamp less 2 minutes: ${timeInSeconds}`);
    }

    const timeInBN = web3.utils.toBN(timeInSeconds);
    const time = new Date(timeInSeconds * 10e2);

    const deployedVoting = await Voting.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    );
    const deployedIdentifierWhitelist = await IdentifierWhitelist.at(
      await deployedFinder.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist))
    );
    await deployedIdentifierWhitelist.addSupportedIdentifier(identifierInBytes);
    const priceExists = await deployedVoting.hasPrice(identifierInBytes, timeInBN);
    if (priceExists) {
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

  // Note: use ENV for port because in some cases GCP doesn't allow the user to change the docker args.
  if (process.env.PORT) {
    // Only trigger on request if PORT is in the ENV. Otherwise, we assume the user wants it called synchronously.
    await triggerOnRequest(async () => {
      // Clear the nonce cache on every new request so a long-running server doesn't use a stale nonce.
      if (web3.currentProvider.engine && web3.currentProvider.engine._providers) {
        for (const provider of web3.currentProvider.engine._providers) {
          if (provider.nonceCache) {
            provider.nonceCache = {};
          }
        }
      }

      // Request the price.
      await run(finder, argv.identifier, argv.time);
    });
  } else {
    await run(finder, argv.identifier, argv.time);

    // Note: only call the callback in the non-server case. In the server case, the server is expected to run
    // indefinitely.
    callback();
  }
};

// Attach this function to the exported function
// in order to allow the script to be executed through both truffle and a test runner.
runRequestOraclePrice.run = run;
module.exports = runRequestOraclePrice;
