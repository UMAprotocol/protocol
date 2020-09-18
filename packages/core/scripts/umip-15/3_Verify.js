// This script verify that the UMPIP-14 upgrade was executed correctly by checking deployed bytecodes,
// assigned ownerships and roles. It can be run on the main net after the upgrade is completed
// or on the local Ganache mainnet fork to validate the execution of the previous  two scripts.
// This script does not need any wallets unlocked and does not make any on-chain state changes. It can be run as:
// yarn truffle exec ./scripts/UMIP-15/3_Verify.js --network mainnet-fork --votingAddress 0x-new-voting-contract-address
// votingAddress is optional. If not included then the script will pull from the current truffle artifacts. This lets
// you verify the output before running yarn load-addresses
const assert = require("assert").strict;
const argv = require("minimist")(process.argv.slice(), { string: ["votingAddress"] });

const Voting = artifacts.require("Voting");
const Finder = artifacts.require("Finder");
const Governor = artifacts.require("Governor");

const { interfaceName } = require("@uma/common");

const zeroAddress = "0x0000000000000000000000000000000000000000";

async function runExport() {
  console.log("Running UMIP-15 Upgrade Verifier🔥");
  let votingAddress = argv.votingAddress;
  if (!votingAddress) {
    throw new Error("No votingAddress paramter specified! Define the new voting contract.");
  }

  console.log(" 1. Validating finder registration of new voting contract addresses...");

  // The finder should correctly match the addresses of new contracts
  const finder = await Finder.deployed();
  const interfaceNameBytes32 = web3.utils.utf8ToHex(interfaceName.Oracle);
  const finderSetAddress = await finder.getImplementationAddress(interfaceNameBytes32);
  assert.equal(web3.utils.toChecksumAddress(finderSetAddress), web3.utils.toChecksumAddress(votingAddress));

  console.log("✅ Voting registered interfaces match!");
  console.log(" 2. Validating deployed contracts are owned by governor...");

  const newVotingContract = await Voting.at(votingAddress);
  const currentOwner = await newVotingContract.owner();
  assert.equal(web3.utils.toChecksumAddress(currentOwner), web3.utils.toChecksumAddress(Governor.address));

  console.log("✅ Voting correctly transferred ownership!");

  console.log(" 3. Validating old voting is in migrated state & still owned by governor...");

  const oldVotingContract = await Voting.deployed();
  const migrationAddress = await oldVotingContract.migratedAddress();
  assert.notEqual(migrationAddress, zeroAddress);
  assert.equal(await oldVotingContract.owner(), Governor.address);

  console.log("✅ Voting correctly transferred ownership!");
}

run = async function(callback) {
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
