// This script generates and submits UMIP-3 upgrade transactions to the DVM. It can be run on a local ganache
// fork of the mainnet or can be run directly on the mainnet to execute the upgrade transactions.
// To run this on the localhost first fork mainnet into Ganache with the proposerWallet unlocked as follows:
// ganache-cli --fork https://mainnet.infura.io/v3/d70106f59aef456c9e5bfbb0c2cc7164 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25
// Then execute the script as: truffle exec ./scripts/umip-3/1_Propose.js --network mainnet-fork from core

const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const Store = artifacts.require("Store");
const IdentifierWhitelist = artifacts.require("IdentifierWhitelist");
const Governor = artifacts.require("Governor");
const FinancialContractsAdmin = artifacts.require("FinancialContractsAdmin");
const VotingToken = artifacts.require("VotingToken");
const Umip3Upgrader = artifacts.require("Umip3Upgrader");

const { RegistryRolesEnum } = require("@uma/common");

const tdr = require("truffle-deploy-registry");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const zeroAddress = "0x0000000000000000000000000000000000000000";

async function runExport() {
  console.log("Running UMIP-3 Upgrade🔥");
  console.log("Connected to network id", await web3.eth.net.getId());

  // Get the previously deployed VotingToken and Finder.
  console.log("Keeping Existing VotingToken", VotingToken.address);
  console.log("Keeping Existing Finder", Finder.address);
  console.log("Sending Proposal to Existing Governor", Governor.address);

  const votingToken = await VotingToken.deployed();
  const finder = await Finder.deployed();
  const governor = await Governor.deployed();
  const existingVoting = await Voting.deployed();

  /** ***********************
   * 1) upgrade Voting.sol *
   *************************/

  // Set the GAT percentage to 5%
  const gatPercentage = { rawValue: web3.utils.toWei("0.05", "ether") };

  // Set the inflation rate.
  const inflationRate = { rawValue: web3.utils.toWei("0.0005", "ether") };

  // Set the rewards expiration timeout.
  const rewardsExpirationTimeout = 60 * 60 * 24 * 14; // Two weeks.

  // Set phase length to one day.
  const secondsPerDay = "86400";

  console.log("Deploying new Voting contract.");

  const voting = await Voting.new(
    secondsPerDay,
    gatPercentage,
    inflationRate,
    rewardsExpirationTimeout,
    VotingToken.address,
    Finder.address,
    zeroAddress,
    { from: proposerWallet }
  );

  /** **************************
   * 2) upgrade Registry.sol *
   ***************************/

  console.log("Deploying new Registry contract.");

  const registry = await Registry.new({ from: proposerWallet });

  /** ***********************
   * 3) upgrade Store.sol *
   ************************/

  console.log("Deploying new Store contract.");

  const regularFee = { rawValue: "0" };
  const lateFee = { rawValue: "0" };

  const store = await Store.new(regularFee, lateFee, zeroAddress, { from: proposerWallet });

  /** *****************************************
   * 4) upgrade FinancialContractsAdmin.sol *
   ******************************************/

  console.log("Deploying new FinancialContractsAdmin contract.");

  const financialContractsAdmin = await FinancialContractsAdmin.new({ from: proposerWallet });

  /** *****************************************
   * 5) upgrade IdentifierWhitelist.sol *
   ******************************************/

  console.log("Deploying new IdentifierWhitelist contract.");

  const identifierWhitelist = await IdentifierWhitelist.new({ from: proposerWallet });

  /** *****************************************
   * 6) deploy Governor.sol *
   ******************************************/

  console.log("Deploying new Governor contract.");

  // Add 1 to the existing proposal count to take into account the proposal that we're about to send.
  const startingId = (await governor.numProposals()).addn(1).toString();

  const newGovernor = await Governor.new(finder.address, startingId, zeroAddress, { from: proposerWallet });

  /** ********************************************
   * 7) update permissions on all new contracts *
   **********************************************/

  console.log("Updating new contracts' permissions.");

  // Add governor as a special registered contract so it can send proposals to the Voting contract.
  await registry.addMember(RegistryRolesEnum.CONTRACT_CREATOR, proposerWallet, { from: proposerWallet });
  await registry.registerContract([], newGovernor.address, { from: proposerWallet });
  await registry.removeMember(RegistryRolesEnum.CONTRACT_CREATOR, proposerWallet, { from: proposerWallet });

  // The owner role is generally the 0th role (this is true for all the contracts in this script).
  const ownerRole = "0";

  // Governor is owned by the owner of the previous governor and the proposerWallet should remain the proposer.
  const multisig = await governor.getMember(ownerRole);
  await newGovernor.resetMember(ownerRole, multisig, { from: proposerWallet });

  // Registry should be owned by the governor.
  await registry.resetMember(ownerRole, newGovernor.address, { from: proposerWallet });

  // FinancialContractsAdmin should be owned by the governor.
  await financialContractsAdmin.transferOwnership(newGovernor.address, { from: proposerWallet });

  // Store should be owned by the governor and the hot wallet/deployer should remain the withdrawer.
  await store.resetMember(ownerRole, newGovernor.address, { from: proposerWallet });

  // Identifier Whitelist should be owned by governor
  await identifierWhitelist.transferOwnership(newGovernor.address, { from: proposerWallet });

  // Voting should be owned by governor
  await voting.transferOwnership(newGovernor.address, { from: proposerWallet });

  /** *********************************************
   * 8) update permissions on existing contracts *
   ***********************************************/

  console.log("Preparing proposal transactions related to permissioning on existing contracts.");

  // Add Voting contract as a minter, so rewards can be minted in the existing token.
  // Note: this transaction must come before the owner is moved to the new Governor.
  const minter = "1";
  const addVotingAsTokenMinterTx = votingToken.contract.methods.addMember(minter, voting.address).encodeABI();

  console.log("addVotingAsTokenMinterTx", addVotingAsTokenMinterTx);

  // New Governor should own the token.
  const changeVotingTokenOwnerTx = votingToken.contract.methods.resetMember(ownerRole, newGovernor.address).encodeABI();

  console.log("changeVotingTokenOwnerTx", changeVotingTokenOwnerTx);

  // Because the transaction ordering prevents the Finder permissioning changes from being executed by the Governor
  // direcly, an upgrader contract is used to temporarily hold the Finder ownership permissions and synchronously
  // move them.
  console.log("Deploying the Umip3Upgrader contract.");

  const umip3Upgrader = await Umip3Upgrader.new(
    governor.address,
    existingVoting.address,
    finder.address,
    voting.address,
    identifierWhitelist.address,
    store.address,
    financialContractsAdmin.address,
    registry.address,
    newGovernor.address,
    { from: proposerWallet }
  );

  // The Umip3Upgrader need to be given ownership of the finder for it to execute the upgrade.
  const setUmip3UpgraderFinderOwnerTx = finder.contract.methods.transferOwnership(umip3Upgrader.address).encodeABI();

  console.log("setUmip3UpgraderFinderOwnerTx", setUmip3UpgraderFinderOwnerTx);

  // The Umip3Upgrader need to be given ownership of the existing voting contract for it to set the migrated address.
  const setUmip3UpgraderVotingOwnerTx = existingVoting.contract.methods
    .transferOwnership(umip3Upgrader.address)
    .encodeABI();

  console.log("setUmip3UpgraderVotingOwnerTx", setUmip3UpgraderVotingOwnerTx);

  // After it's given ownership, the upgrade transaction needs to be executed.
  const executeUmip3UpgraderTx = umip3Upgrader.contract.methods.upgrade().encodeABI();

  console.log("executeUmip3UpgraderTx", executeUmip3UpgraderTx);

  /** *********************************
   * 9) Propose upgrades to governor *
   ***********************************/

  await governor.propose(
    [
      { to: votingToken.address, value: 0, data: addVotingAsTokenMinterTx },
      { to: votingToken.address, value: 0, data: changeVotingTokenOwnerTx },
      { to: finder.address, value: 0, data: setUmip3UpgraderFinderOwnerTx },
      { to: existingVoting.address, value: 0, data: setUmip3UpgraderVotingOwnerTx },
      { to: umip3Upgrader.address, value: 0, data: executeUmip3UpgraderTx },
    ],
    { from: proposerWallet }
  );

  console.log("Adding new contracts to the Registry");

  await tdr.appendInstance(voting);
  await tdr.appendInstance(registry);
  await tdr.appendInstance(store);
  await tdr.appendInstance(financialContractsAdmin);
  await tdr.appendInstance(identifierWhitelist);
  await tdr.appendInstance(newGovernor);

  console.log(`

Newly Proposed DVM Addresses

Voting:                  ${voting.address}
Registry:                ${registry.address}
Store:                   ${store.address}
FinancialContractsAdmin: ${financialContractsAdmin.address}
IdentifierWhitelist:     ${identifierWhitelist.address}
Governor:                ${newGovernor.address}
`);
}

const run = async function (callback) {
  try {
    await runExport();
  } catch (err) {
    callback(err);
    return;
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
run.runExport = runExport;
module.exports = run;
