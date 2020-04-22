const assert = require("assert").strict;
const truffleAssert = require("truffle-assertions");

const { getRandomUnsignedInt } = require("../../../common/Random.js");
const { computeVoteHash } = require("../../../common/EncryptionHelper.js");

const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";

const Voting = artifacts.require("Voting");
const VotingToken = artifacts.require("VotingToken");
const Governor = artifacts.require("Governor");
const BulkGovernorExecutor = artifacts.require("BulkGovernorExecutor");

async function runExport() {
  console.log("Running UMIP-3 Upgrade vote simulator🔥");
  let snapshot = await takeSnapshot();
  snapshotId = snapshot["result"];
  console.log("Snapshotting starting state...", snapshotId);

  /** *********************************
   * 0) Initial setup                *
   ***********************************/

  console.log("0. SETUP PHASE");
  const votingToken = await VotingToken.deployed();
  const voting = await Voting.deployed();
  const governor = await Governor.deployed();

  const bulkGovernorExecutor = await BulkGovernorExecutor.new();

  let currentTime = (await voting.getCurrentTime()).toNumber();
  let votingPhase = (await voting.getVotePhase()).toNumber();

  const secondsPerDay = 86400;
  const accounts = await web3.eth.getAccounts();

  // These two assertions must be true for the script to be starting in the right state. This assumes the script
  // is run within the same round and phase as running the `Propose.js` script.
  assert.equal((await governor.numProposals()).toNumber(), 1); // there should be 1 proposal
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
    await advanceBlockAndSetTime(currentTime + secondsPerDay * 2);
  } else {
    await advanceBlockAndSetTime(currentTime + secondsPerDay);
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
  const price = "1"; // a "yes" vote

  const salt = getRandomUnsignedInt();
  // Main net DVM uses the old commit reveal scheme of hashed concatenation of price and salt
  const voteHash = web3.utils.soliditySha3(price, salt);

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
  await advanceBlockAndSetTime(currentTime + secondsPerDay);

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
  await advanceBlockAndSetTime(currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to conclude vote\nNew timestamp:",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    (await voting.getVotePhase()).toNumber(),
    "currentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );

  assert.equal((await voting.getPendingRequests()).length, 0); // There should be no pending requests as vote is concluded

  /** *******************************************************************
   * 4) Execute proposal submitted to governor now that voting is done *
   **********************************************************************/

  console.log("4. EXECUTING GOVERNOR PROPOSALS");
  const proposalId = 0; // first and only proposal in voting.sol
  const proposal = await governor.getProposal(proposalId);

  // for every transactions within the proposal
  for (let i = 0; i < proposal.transactions.length; i++) {
    console.log("Submitting tx", i, "...");
    let tx = await governor.executeProposal(proposalId.toString(), i.toString(), { from: foundationWallet });
    console.log("Transaction", i, "submitted! tx", tx.tx);
  }

  console.log("5. GOVERNOR TRANSACTIONS SUCCESSFULLY EXECUTED🎉!");

  console.log("SCRIPT DONE...REVERTING STATE...", snapshotId);
  await revertToSnapshot(snapshotId);
}

run = async function(callback) {
  try {
    await runExport();
  } catch (err) {
    console.error(err);
    // If the script crashes revert the state to the snapshotted state
    console.log("SCRIPT CRASHED...REVERTING STATE...", snapshotId);
    await revertToSnapshot(snapshotId);
  }
  callback();
};

advanceBlockAndSetTime = time => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [time],
        id: new Date().getTime()
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      }
    );
  });
};

advanceTimeAndBlock = async time => {
  // capture current time
  let block = await web3.eth.getBlock("latest");
  let forwardTime = block["timestamp"] + time;

  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_mine",
        params: [forwardTime],
        id: new Date().getTime()
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      }
    );
  });
};

takeSnapshot = () => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_snapshot",
        id: new Date().getTime()
      },
      (err, snapshotId) => {
        if (err) {
          return reject(err);
        }
        return resolve(snapshotId);
      }
    );
  });
};

revertToSnapshot = id => {
  return new Promise((resolve, reject) => {
    web3.currentProvider.send(
      {
        jsonrpc: "2.0",
        method: "evm_revert",
        params: [id],
        id: new Date().getTime()
      },
      (err, result) => {
        if (err) {
          return reject(err);
        }
        return resolve(result);
      }
    );
  });
};

run.runExport = runExport;
module.exports = run;
