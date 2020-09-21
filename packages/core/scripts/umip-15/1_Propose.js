// This script generates and submits an an upgrade to the DVM to swap out the Voting contract with an updated version as
// part of UMIP-15. It can be run on a local ganache fork of the main net or can be run directly on the main net to
// execute the upgrade transactions. To run this on the localhost first fork main net into Ganache with the
// proposerWallet unlocked as follows: ganache-cli --fork https://mainnet.infura.io/v3/d70106f59aef456c9e5bfbb0c2cc7164 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
// Then execute the script as: yarn truffle exec ./scripts/UMIP-15/1_Propose.js --network mainnet-fork from core

const argv = require("minimist")(process.argv.slice(), { boolean: ["revert"] });

const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const Governor = artifacts.require("Governor");
const Umip15Upgrader = artifacts.require("Umip15Upgrader");

const { takeSnapshot, revertToSnapshot } = require("@uma/common");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const zeroAddress = "0x0000000000000000000000000000000000000000";

async function runExport() {
  let snapshot = await takeSnapshot(web3);
  let snapshotId = snapshot["result"];

  console.log("Running UMIP-15 Upgrade🔥");
  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const registry = await Registry.deployed();
  console.log("registry loaded \t\t", registry.address);

  const finder = await Finder.deployed();
  console.log("finder loaded \t\t\t", finder.address);

  const existingVoting = await Voting.deployed();
  console.log("voting loaded \t\t\t", existingVoting.address);

  const votingToken = await VotingToken.deployed();
  console.log("finder loaded \t\t\t", votingToken.address);

  const governor = await Governor.deployed();
  console.log("governor loaded \t\t", governor.address);

  console.log("2. DEPLOYED UPGRADED VOTING.SOL");

  // Set the GAT percentage to 5%
  const gatPercentage = { rawValue: web3.utils.toWei("0.05", "ether") };

  // Set the inflation rate.
  const inflationRate = { rawValue: web3.utils.toWei("0.0005", "ether") };

  // Set the rewards expiration timeout.
  const rewardsExpirationTimeout = 60 * 60 * 24 * 14; // Two weeks.

  // Set phase length to one day.
  const secondsPerDay = "86400";

  const newVoting = await Voting.new(
    secondsPerDay,
    gatPercentage,
    inflationRate,
    rewardsExpirationTimeout,
    votingToken.address,
    finder.address,
    zeroAddress,
    { from: proposerWallet }
  );

  console.log("Deployed voting contract:\t", newVoting.address);

  console.log("3. DEPLOYED UMIP-15UPGRADER.sol");
  const umip15Upgrader = await Umip15Upgrader.new(
    governor.address,
    existingVoting.address,
    newVoting.address,
    finder.address,
    {
      from: proposerWallet
    }
  );

  console.log("Deployed UMIP-upgrader\t", umip15Upgrader.address);

  console.log("4. TRANSFERRING OWNERSHIP OF NEW VOTING TO GOVERNOR");
  await newVoting.transferOwnership(governor.address, { from: proposerWallet });

  console.log("5. CRAFTING GOVERNOR TRANSACTIONS");

  const transferFinderOwnershipTx = finder.contract.methods.transferOwnership(umip15Upgrader.address).encodeABI();

  console.log("5.a. Transfer finder ownership tx data:", transferFinderOwnershipTx);

  const transferExistingVotingOwnershipTx = existingVoting.contract.methods
    .transferOwnership(umip15Upgrader.address)
    .encodeABI();

  console.log("5.b. Transfer existing voting ownership tx data:", transferExistingVotingOwnershipTx);

  const upgraderExecuteUpgradeTx = umip15Upgrader.contract.methods.upgrade().encodeABI();

  console.log("5.c. Upgrader Execute Upgrade tx data:", upgraderExecuteUpgradeTx);

  console.log("6. SENDING PROPOSAL TXS TO GOVERNOR");

  // Send the proposal to governor
  await governor.propose(
    [
      {
        to: finder.address,
        value: 0,
        data: transferFinderOwnershipTx
      },
      {
        to: existingVoting.address,
        value: 0,
        data: transferExistingVotingOwnershipTx
      },
      {
        to: umip15Upgrader.address,
        value: 0,
        data: upgraderExecuteUpgradeTx
      }
    ],
    { from: proposerWallet, gas: 2000000 }
  );

  console.log("Contracts deployed and proposal done!🎉");

  if (argv.revert) {
    console.log("SCRIPT DONE...REVERTING STATE...", snapshotId);
    await revertToSnapshot(web3, snapshotId);
  }
}

const run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    console.error(err);
    callback(err);
    return;
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
run.runExport = runExport;
module.exports = run;
