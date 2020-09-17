// This script generates and submits an an upgrade to the DVM to swap out the Voting contract with an updated version as
// part of UMIP-14. It can be run on a local ganache fork of the main net or can be run directly on the main net to
// execute the upgrade transactions. To run this on the localhost first fork main net into Ganache with the
// proposerWallet unlocked as follows: ganache-cli --fork https://mainnet.infura.io/v3/d70106f59aef456c9e5bfbb0c2cc7164 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
// Then execute the script as: yarn truffle exec ./scripts/umip-14/1_Propose.js --network mainnet-fork from core

const argv = require("minimist")(process.argv.slice(), { boolean: ["revert"] });

const Finder = artifacts.require("Finder");
const Registry = artifacts.require("Registry");
const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const Governor = artifacts.require("Governor");

const { takeSnapshot, revertToSnapshot, interfaceName } = require("@uma/common");

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";
const zeroAddress = "0x0000000000000000000000000000000000000000";

async function runExport() {
  let snapshot = await takeSnapshot(web3);
  snapshotId = snapshot["result"];

  console.log("Running UMIP-14 Upgrade🔥");
  const networkId = await web3.eth.net.getId();
  console.log("Connected to network id", networkId);

  /** ********************************
   * 1. Load contract infrastructure *
   ***********************************/
  console.log("1. Loading deployed contract state");

  const registry = await Registry.deployed();
  console.log("registry loaded \t\t", registry.address);

  const finder = await Finder.deployed();
  console.log("finder loaded \t\t\t", finder.address);

  const voting = await Voting.deployed();
  console.log("voting loaded \t\t\t", voting.address);

  const votingToken = await VotingToken.deployed();
  console.log("finder loaded \t\t\t", votingToken.address);

  const governor = await Governor.deployed();
  console.log("governor loaded \t\t", governor.address);

  /** ********************************
   * 1. Deploying new Voting for DVM *
   ***********************************/
  console.log("2. Deploying voting.sol");

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

  console.log("Deployed voting contract: ", newVoting.address);

  console.log("3. Setting governor as owner");
  await newVoting.transferOwnership(governor.address, { from: proposerWallet });

  console.log("4. Crafting and submitting upgrade proposal");

  const changeVotingAddressInFinderTx = finder.contract.methods
    .changeImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle), newVoting.address)
    .encodeABI();

  console.log("Change voting address in finder tx data:", changeVotingAddressInFinderTx);

  // Send the proposal to governor
  await governor.propose(
    [
      {
        to: finder.address,
        value: 0,
        data: changeVotingAddressInFinderTx
      }
    ],
    { from: proposerWallet }
  );

  console.log("Contracts deployed and proposal done!🎉");

  if (argv.revert) {
    console.log("SCRIPT DONE...REVERTING STATE...", snapshotId);
    await revertToSnapshot(web3, snapshotId);
  }
}

run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    console.error(err);
    console.log("SCRIPT CRASHED...REVERTING STATE...", snapshotId);
    await revertToSnapshot(web3, snapshotId);
    callback(err);
    return;
  }
  callback();
};

// Attach this function to the exported function in order to allow the script to be executed through both truffle and a test runner.
run.runExport = runExport;
module.exports = run;
