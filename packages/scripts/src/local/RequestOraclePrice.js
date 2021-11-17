#!/usr/bin/env node

const { getContract, web3 } = require("hardhat");

const argv = require("minimist")(process.argv.slice(), { string: ["identifier", "time"] });

const Finder = getContract("Finder");
const Voting = getContract("Voting");
const IdentifierWhitelist = getContract("IdentifierWhitelist");
const Registry = getContract("Registry");
const { interfaceName, RegistryRolesEnum } = require("@uma/common");

async function getDeployAddress() {
  const accounts = await web3.eth.getAccounts();
  return accounts[0];
}

async function registerContract(registry) {
  const deployAddress = await getDeployAddress();

  if (!(await registry.methods.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, deployAddress).call())) {
    // Wrapping with an if isn't strictly necessary, but saves gas when script is used regularly.
    await registry.methods.addMember(RegistryRolesEnum.CONTRACT_CREATOR, deployAddress).send({ from: deployAddress });
    console.log("Creator Added:", deployAddress);
  }

  if (!(await registry.methods.isContractRegistered(deployAddress).call())) {
    await registry.methods.registerContract([], deployAddress).send({ from: deployAddress });
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
async function run(deployedFinder, identifier, timeString, ancillaryData = "") {
  const account = await getDeployAddress();
  const deployedRegistry = await Registry.at(
    await deployedFinder.methods.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Registry)).call()
  );
  await registerContract(deployedRegistry, account);

  const identifierInBytes = web3.utils.fromAscii(identifier);
  const ancillaryDataInBytes = ancillaryData.length ? web3.utils.fromAscii(ancillaryData) : null;

  let timeInSeconds = parseInt(timeString);
  if (timeInSeconds === 0) {
    // If time input is 0, use current time (less 2 minutes to ensure we don't jump in front of the block timestamp).
    timeInSeconds = Math.floor(new Date().getTime() / 10e2) - 120;
    console.log(`User provided timestamp of 0, using current timestamp less 2 minutes: ${timeInSeconds}`);
  }

  const timeInBN = web3.utils.toBN(timeInSeconds);
  const time = new Date(timeInSeconds * 10e2);

  const deployedVoting = await Voting.at(
    await deployedFinder.methods.getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle)).call()
  );
  const deployedIdentifierWhitelist = await IdentifierWhitelist.at(
    await deployedFinder.methods
      .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.IdentifierWhitelist))
      .call()
  );
  await deployedIdentifierWhitelist.methods.addSupportedIdentifier(identifierInBytes).send({ from: account });
  let priceExists;

  if (ancillaryDataInBytes) {
    priceExists = await deployedVoting.methods.hasPrice(identifierInBytes, timeInBN, ancillaryDataInBytes).call();
  } else {
    priceExists = await deployedVoting.methods.hasPrice(identifierInBytes, timeInBN).call();
  }
  if (priceExists) {
    console.log(`Price already exists for ${identifier} @ ${time} : ${ancillaryData}`);
    return;
  }

  if (ancillaryDataInBytes) {
    await deployedVoting.methods
      .requestPrice(identifierInBytes, timeInBN, ancillaryDataInBytes)
      .send({ from: account });
  } else {
    await deployedVoting.methods.requestPrice(identifierInBytes, timeInBN).send({ from: account });
  }

  console.log(`Price requested for ${identifier} @ ${time}`);
}

async function main() {
  // Usage: truffle exec scripts/RequestOraclePrice.js --identifier <identifier> --time <time> --network <network>
  // where <time> is seconds since January 1st, 1970 00:00:00 UTC.
  if (!argv.identifier) {
    throw new Error("Must include <identifier>");
  }

  if (!argv.time) {
    throw new Error("Must include <time>");
  }

  const finder = await Finder.deployed();
  await run(finder, argv.identifier, argv.time, argv.ancillaryData);
}

main().then(
  () => {
    process.exit(0);
  },
  (error) => {
    console.error(error);
    process.exit(1);
  }
);
