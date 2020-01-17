const Registry = artifacts.require("Registry");
const Finder = artifacts.require("Finder");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const Store = artifacts.require("Store");
const Voting = artifacts.require("Voting");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const VotingToken = artifacts.require("VotingToken");
const Governor = artifacts.require("Governor");

const argv = require("minimist")(process.argv.slice(), { string: ["multisig"] });

async function transferPermissions(multisig) {
  // The owner role is generally the 0th role (this is true for all the contracts in this script).
  const ownerRole = "0";

  // Governor is owned by the multisig and the hot wallet/deployer should remain the proposer.
  const governor = await Governor.deployed();
  await governor.resetMember(ownerRole, multisig);

  // Registry should be owned by the governor.
  const registry = await Registry.deployed();
  await registry.resetMember(ownerRole, governor.address);

  // Finder should be owned by the governor.
  const finder = await Finder.deployed();
  await finder.transferOwnership(governor.address);

  // FinancialContractsAdmin should be owned by the governor.
  const financialContractsAdmin = await FinancialContractsAdmin.deployed();
  await financialContractsAdmin.transferOwnership(governor.address);

  // Store should be owned by the governor and the hot wallet/deployer should remain the withdrawer.
  const store = await Store.deployed();
  await store.resetMember(ownerRole, governor.address);

  // Identifier Whitelist should be owned by governor
  const supportedIdentifiers = await IdentifierWhitelist.deployed();
  await supportedIdentifiers.transferOwnership(governor.address);

  // Voting should be owned by governor
  const voting = await Voting.deployed();
  await voting.transferOwnership(governor.address);

  // VotingToken should be owned by the governor.
  const votingToken = await VotingToken.deployed();
  await votingToken.resetMember(ownerRole, governor.address);
}

// This script moves certain permissions from the truffle in-memory hot key to the governor and foundation multisig.
async function wrapper(callback) {
  try {
    await transferPermissions(argv.multisig);
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
}

wrapper.transferPermissions = transferPermissions;
module.exports = wrapper;
