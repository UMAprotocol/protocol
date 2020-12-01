// This script simulates a vote from a large token holder to ratify the proposal from script 1_Propose.js.
// It is intended to be run on a main-net Ganache fork with the foundation wallet unlocked. Leading on
// from the previous script run a ganache cli instance as:
// ganache-cli --fork https://mainnet.infura.io/v3/5f56f0a4c8844c96a430fbd3d7993e39 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
// then run the script as: yarn truffle exec ./scripts/umip-3/2_VoteSimulate.js --network mainnet-fork

const assert = require("assert").strict;

const {
  getRandomUnsignedInt,
  advanceBlockAndSetTime,
  takeSnapshot,
  revertToSnapshot,
  computeVoteHash,
  signMessage
} = require("@uma/common");
const argv = require("minimist")(process.argv.slice(), { boolean: ["revert"] });

// Address which holds a lot of UMA tokens to mock a majority vote
const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";

const { getAbi, getAddress } = require("../../index");

let snapshotId;

async function runExport() {
  console.log("Running Upgrade vote simulator🔥");
  let snapshot = await takeSnapshot(web3);
  snapshotId = snapshot["result"];
  console.log("Snapshotting starting state...", snapshotId);

  /** *********************************
   * 0) Initial setup                *
   ***********************************/

  console.log("0. SETUP PHASE");
  // const voting = await Voting.deployed();
  const voting = new web3.eth.Contract(getAbi("Voting", "1.1.0"), getAddress("Voting", "1", "1.1.0"));
  const governor = new web3.eth.Contract(getAbi("Governor", "1.1.0"), getAddress("Governor", "1", "1.1.0"));

  let currentTime = Number(await voting.methods.getCurrentTime().call());
  let votingPhase = Number(await voting.methods.getVotePhase().call());

  const secondsPerDay = 86400;
  const accounts = await web3.eth.getAccounts();

  // These two assertions must be true for the script to be starting in the right state. This assumes the script
  // is run within the same round and phase as running the `Propose.js` script.
  assert(Number(await governor.methods.numProposals().call()) > 1);

  console.log(
    "1 pending proposal. No pending requests.\nCurrent timestamp:",
    currentTime,
    "Voting phase:",
    votingPhase,
    "CurrentRoundId",
    (await voting.methods.getCurrentRoundId().call()).toString()
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
    await voting.methods.getCurrentTime().call(),
    "voting phase",
    await voting.methods.getVotePhase().call(),
    "CurrentRoundId",
    await voting.methods.getCurrentRoundId().call()
  );
  let pendingRequests = await voting.methods.getPendingRequests().call();
  assert.equal(pendingRequests.length, 1); // the one proposal should have advanced to a request

  /** *****************************************************
   * 2) Build vote tx from the foundation wallet         *
   *******************************************************/

  let currentRoundId = await voting.methods.getCurrentRoundId().call();

  const identifier = pendingRequests[0].identifier.toString();
  const time = pendingRequests[0].time.toString();
  const price = web3.utils.toWei("1"); // a "yes" vote

  const salt = getRandomUnsignedInt();
  // Main net DVM uses the old commit reveal scheme of hashed concatenation of price and salt
  let voteHash;
  const request = pendingRequests[0];
  voteHash = computeVoteHash({
    price,
    salt,
    account: foundationWallet,
    time: request.time,
    roundId: currentRoundId,
    identifier: request.identifier
  });

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
  await web3.eth.sendTransaction({
    from: accounts[0],
    to: foundationWallet,
    value: web3.utils.toWei("1"),
    gas: 2000000
  });

  const VoteTx = await voting.methods
    .commitVote(identifier, time, voteHash)
    .send({ from: foundationWallet, gas: 2000000 });
  console.log("Voting Tx done!", VoteTx.transactionHash);

  /** *****************************************************
   * 4) Advance to the next phase & reveal the vote      *
   *******************************************************/
  console.log("3. REVEALING FOUNDATION VOTE");
  currentTime = Number(await voting.methods.getCurrentTime().call());
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to enable reveal\nNew timestamp:",
    await voting.methods.getCurrentTime().call(),
    "voting phase",
    Number(await voting.methods.getVotePhase().call()),
    "currentRoundId",
    await voting.methods.getCurrentRoundId().call()
  );

  console.log("📸 Generating a voting token snapshot.");
  const account = (await web3.eth.getAccounts())[0];
  const snapshotMessage = "Sign For Snapshot";
  let signature = await signMessage(web3, snapshotMessage, account);
  await voting.methods.snapshotCurrentRound(signature).send({ from: account, gas: 2000000 });

  const revealTx = await voting.methods
    .revealVote(identifier, time, price, salt.toString())
    .send({ from: foundationWallet, gas: 2000000 });
  console.log("Reveal Tx done!", revealTx.transactionHash);

  currentTime = Number(await voting.methods.getCurrentTime().call());
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to conclude vote\nNew timestamp:",
    await voting.methods.getCurrentTime().call(),
    "voting phase",
    Number(await voting.methods.getVotePhase().call()),
    "currentRoundId",
    await voting.methods.getCurrentRoundId().call()
  );

  assert.equal((await voting.methods.getPendingRequests().call()).length, 0); // There should be no pending requests as vote is concluded

  /** *******************************************************************
   * 4) Execute proposal submitted to governor now that voting is done *
   **********************************************************************/

  console.log("4. EXECUTING GOVERNOR PROPOSALS");
  const proposalId = (Number(await governor.methods.numProposals().call()) - 1).toString(); // most recent proposal in voting.sol
  const proposal = await governor.methods.getProposal(proposalId.toString()).call();
  console.log(proposal.transactions[0]);

  // for every transactions within the proposal
  for (let i = 0; i < proposal.transactions.length; i++) {
    console.log("Submitting tx", i, "...");
    let tx = await governor.methods.executeProposal(proposalId.toString(), i.toString()).send({
      from: foundationWallet,
      gas: 2000000
    });
    console.log("Transaction", i, "submitted! tx", tx.transactionHash);
  }

  console.log("5. GOVERNOR TRANSACTIONS SUCCESSFULLY EXECUTED🎉!");

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
    // If the script crashes revert the state to the snapshotted state
    console.log("SCRIPT CRASHED...REVERTING STATE...", snapshotId);
    await revertToSnapshot(web3, snapshotId);
  }
  callback();
};

run.runExport = runExport;
module.exports = run;
