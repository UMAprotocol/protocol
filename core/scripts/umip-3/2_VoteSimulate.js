// This script simulates a vote from a large token holder to ratify the proposal from script 1_Propose.js.
// It is intended to be run on a main-net Ganache fork with the foundation wallet unlocked. Leading on
// from the previous script run a ganache cli instance as:
// ganache-cli --fork https://mainnet.infura.io/v3/d70106f59aef456c9e5bfbb0c2cc7164 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc
// then run the script as: truffle exec ./scripts/umip-3/2_VoteSimulate.js --network mainnet-fork

const assert = require("assert").strict;

const { getRandomUnsignedInt } = require("../../../common/Random.js");
const { advanceBlockAndSetTime, takeSnapshot, revertToSnapshot } = require("../../../common/SolidityTestUtils.js");
const { computeVoteHash } = require("../../../common/EncryptionHelper");
const argv = require("minimist")(process.argv.slice(), { boolean: ["repeated", "revert"] });

// Address which holds a lot of UMA tokens to mock a majority vote
const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";

const Voting = artifacts.require("Voting");
const Governor = artifacts.require("Governor");

const resetStateAfterSimulation = false;

async function runExport() {
  console.log("Running UMIP-3 Upgrade vote simulator🔥");
  let snapshot = await takeSnapshot(web3);
  snapshotId = snapshot["result"];
  console.log("Snapshotting starting state...", snapshotId);

  /** *********************************
   * 0) Initial setup                *
   ***********************************/

  console.log("0. SETUP PHASE");
  const voting = await Voting.deployed();
  const governor = await Governor.deployed();

  let currentTime = (await voting.getCurrentTime()).toNumber();
  let votingPhase = (await voting.getVotePhase()).toNumber();

  const secondsPerDay = 86400;
  const accounts = await web3.eth.getAccounts();

  // These two assertions must be true for the script to be starting in the right state. This assumes the script
  // is run within the same round and phase as running the `Propose.js` script.
  if (argv.repeated) {
    assert((await governor.numProposals()).toNumber() > 1);
  } else {
    assert.equal((await governor.numProposals()).toNumber(), 3); // there should be 3 proposal on the first run.
  }
  assert.equal((await voting.getPendingRequests()).length, 0); // There should be no pending requests

  console.log(
    "1 pending proposal. No pending requests.\nCurrent timestamp:",
    currentTime,
    "Voting phase:",
    votingPhase,
    "CurrentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  /** ****************************************************
   * 1) Advance Ganache block time to move voting round *
   ******************************************************/

  console.log("1. TIME ADVANCE FOR VOTING");

  // If the DVM is currently in the commit phase (0) then we need to advance into the next round by advancing
  // forward by 2 days. Else if we are in the reveal phase (1) then we need to advance into the next round by
  // advancing by one day to take us into the next round.
  if (votingPhase == 0) {
    await advanceBlockAndSetTime(web3, currentTime + secondsPerDay * 2);
  } else {
    await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);
  }
  console.log(
    "⏱  Advancing time by one phase to enable voting by the DVM\nNew timestamp",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "CurrentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );
  let pendingRequests = await voting.getPendingRequests();
  assert.equal(pendingRequests.length, 1); // the one proposal should have advanced to a request

  /** *****************************************************
   * 2) Build vote tx from the foundation wallet         *
   *******************************************************/

  let currentRoundId = (await voting.getCurrentRoundId()).toString();

  const identifier = pendingRequests[0].identifier.toString();
  const time = pendingRequests[0].time.toString();
  const price = web3.utils.toWei("1"); // a "yes" vote

  const salt = getRandomUnsignedInt();
  // Main net DVM uses the old commit reveal scheme of hashed concatenation of price and salt
  let voteHash;
  if (argv.repeated) {
    const request = pendingRequests[0];
    voteHash = computeVoteHash({
      price,
      salt,
      account: foundationWallet,
      time: request.time,
      roundId: currentRoundId,
      identifier: request.identifier
    });
  } else {
    voteHash = web3.utils.soliditySha3(price, salt);
  }

  console.log("2. COMMIT VOTE FROM FOUNDATION WALLET\nVote information:");
  console.table({
    price: price,
    salt: salt.toString(),
    account: foundationWallet,
    time: time,
    roundId: currentRoundId,
    identifier: identifier,
    voteHash: voteHash
  });

  /** *****************************************************
   * 3) Vote on the proposal and validate the commitment *
   *******************************************************/

  // send the foundation wallet some eth to submit the Tx
  await web3.eth.sendTransaction({ from: accounts[0], to: foundationWallet, value: web3.utils.toWei("1") });

  const VoteTx = await voting.commitVote(identifier, time, voteHash, { from: foundationWallet });
  console.log("Voting Tx done!", VoteTx.tx);

  /** *****************************************************
   * 4) Advance to the next phase & reveal the vote      *
   *******************************************************/
  console.log("3. REVEALING FOUNDATION VOTE");
  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to enable reveal\nNew timestamp:",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "currentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  const revealTx = await voting.revealVote(identifier, time, price, salt, { from: foundationWallet });
  console.log("Reveal Tx done!", revealTx.tx);

  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to conclude vote\nNew timestamp:",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "currentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  assert.equal((await voting.getPendingRequests()).length, 1); // There should be no pending requests as vote is concluded

  /** *******************************************************************
   * 4) Execute proposal submitted to governor now that voting is done *
   **********************************************************************/

  console.log("4. EXECUTING GOVERNOR PROPOSALS");
  const proposalId = (await governor.numProposals()).subn(2).toString(); // most recent proposal in voting.sol
  const proposal = await governor.getProposal(proposalId);

  // for every transactions within the proposal
  for (let i = 0; i < proposal.transactions.length; i++) {
    console.log("Submitting tx", i, "...");
    let tx = await governor.executeProposal(proposalId.toString(), i.toString(), { from: foundationWallet });
    console.log("Transaction", i, "submitted! tx", tx.tx);
  }

  console.log("5. GOVERNOR TRANSACTIONS SUCCESSFULLY EXECUTED🎉!");

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
    // If the script crashes revert the state to the snapshotted state
    console.log("SCRIPT CRASHED...REVERTING STATE...", snapshotId);
    await revertToSnapshot(web3, snapshotId);
  }
  callback();
};

run.runExport = runExport;
module.exports = run;
