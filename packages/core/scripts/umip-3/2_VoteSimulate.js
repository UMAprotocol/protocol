// This script simulates a vote from a large token holder to ratify the proposal from script 1_Propose.js.
// It is intended to be run on a main-net Ganache fork with the foundation wallet unlocked. Leading on
// from the previous script run a ganache cli instance as:
// ganache-cli --fork https://mainnet.infura.io/v3/5f56f0a4c8844c96a430fbd3d7993e39 --unlock 0x2bAaA41d155ad8a4126184950B31F50A1513cE25 --unlock 0x7a3a1c2de64f20eb5e916f40d11b01c441b2a8dc --port 9545
// then run the script as: yarn truffle exec ./scripts/umip-3/2_VoteSimulate.js --network mainnet-fork

const assert = require("assert").strict;

const {
  getRandomSignedInt,
  advanceBlockAndSetTime,
  takeSnapshot,
  revertToSnapshot,
  computeVoteHash,
  signMessage,
  isAdminRequest,
} = require("@uma/common");
const argv = require("minimist")(process.argv.slice(), { boolean: ["revert"] });

// Address which holds a lot of UMA tokens to mock a majority vote
const foundationWallet = "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc";

// Use the same ABI's as deployed contracts:
const { getTruffleContract } = require("../../dist/index");
const Governor = getTruffleContract("Governor", web3, "1.1.0");
const Finder = getTruffleContract("Finder", web3, "1.1.0");
// Use VotingInterface when committing or revealing to match the correct commit and reveal function signatures
// without an `ancillaryData` param.
const VotingInterface = getTruffleContract("VotingInterface", web3);
// Use Voting for methods missing from the interface like `getCurrentTime` and `hasPrice`
const Voting = getTruffleContract("Voting", web3, "1.1.0");

let snapshotId;

function getAdminPendingRequests(requests) {
  return requests.filter((request) => {
    return isAdminRequest(web3.utils.hexToUtf8(request.identifier));
  });
}
async function runExport() {
  console.log("Running Upgrade vote simulator🔥");
  let snapshot = await takeSnapshot(web3);
  snapshotId = snapshot["result"];
  console.log("Snapshotting starting state...", snapshotId);

  /** *********************************
   * 0) Initial setup                *
   ***********************************/

  console.log("0. SETUP PHASE");
  const finder = await Finder.deployed();
  const votingAddress = await finder.getImplementationAddress(web3.utils.utf8ToHex("Oracle"));
  const voting = await Voting.at(votingAddress);
  const votingInterface = await VotingInterface.at(voting.address);
  const governor = await Governor.deployed();

  let currentTime = (await voting.getCurrentTime()).toNumber();
  let votingPhase = (await votingInterface.getVotePhase()).toNumber();

  const secondsPerDay = 86400;
  const accounts = await web3.eth.getAccounts();

  const numProposals = (await governor.numProposals()).toNumber();

  assert(numProposals >= 1);

  console.log(
    `${numProposals} pending proposal. No pending requests.\nCurrent timestamp:`,
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
  console.log(`Checking pending requests for Voting contract @ ${voting.address}`);
  // Note: `getPendingRequests()` returns unexpected data if `Voting` is not on the current version.
  // This is because the `getPendingRequests` method on Voting has changed its ABI to return a
  // `PendingRequestAncillary` struct which is new to the latest ABI.
  let pendingRequests = getAdminPendingRequests(await votingInterface.getPendingRequests());
  assert(pendingRequests.length >= 1); // there should be at least one pending request

  /** *****************************************************
   * 2) Build vote tx from the foundation wallet         *
   *******************************************************/

  let currentRoundId = (await votingInterface.getCurrentRoundId()).toString();
  const requestsToVoteOn = [];

  for (let pendingIndex = 0; pendingIndex < pendingRequests.length; pendingIndex++) {
    const identifier = pendingRequests[pendingIndex].identifier.toString();
    const time = pendingRequests[pendingIndex].time.toString();
    const price = web3.utils.toWei("1"); // a "yes" vote

    const salt = getRandomSignedInt();
    // Main net DVM uses the old commit reveal scheme of hashed concatenation of price and salt
    let voteHash;
    const request = pendingRequests[pendingIndex];
    voteHash = computeVoteHash({
      price,
      salt,
      account: foundationWallet,
      time: request.time,
      roundId: currentRoundId,
      identifier: request.identifier,
    });
    requestsToVoteOn.push({ identifier, salt, time, price, voteHash });
  }

  console.log("2. COMMIT VOTE FROM FOUNDATION WALLET\nVote information:");

  /** *****************************************************
   * 3) Vote on the proposal and validate the commitment *
   *******************************************************/

  // send the foundation wallet some eth to submit the Tx
  await web3.eth.sendTransaction({
    from: accounts[0],
    to: foundationWallet,
    value: web3.utils.toWei("1"),
    gas: 2000000,
  });

  for (let i = 0; i < pendingRequests.length; i++) {
    const request = requestsToVoteOn[i];
    console.table({
      price: request.price,
      salt: request.salt.toString(),
      account: foundationWallet,
      time: request.time,
      roundId: currentRoundId,
      identifier: request.identifier,
      voteHash: request.voteHash,
    });
    const VoteTx = await votingInterface.commitVote(request.identifier, request.time, request.voteHash, {
      from: foundationWallet,
      gas: 2000000,
    });
    console.log("Voting Tx done!", VoteTx.tx);
  }

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
    (await votingInterface.getVotePhase()).toNumber(),
    "currentRoundId",
    (await votingInterface.getCurrentRoundId()).toString()
  );

  console.log("📸 Generating a voting token snapshot.");
  const account = (await web3.eth.getAccounts())[0];
  const snapshotMessage = "Sign For Snapshot";
  let signature = await signMessage(web3, snapshotMessage, account);
  await votingInterface.snapshotCurrentRound(signature, { from: account, gas: 2000000 });

  for (let i = 0; i < pendingRequests.length; i++) {
    const request = requestsToVoteOn[i];

    const revealTx = await votingInterface.revealVote(request.identifier, request.time, request.price, request.salt, {
      from: foundationWallet,
      gas: 2000000,
    });
    console.log("Reveal Tx done!", revealTx.tx);
  }

  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to conclude vote\nNew timestamp:",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    (await votingInterface.getVotePhase()).toNumber(),
    "currentRoundId",
    (await votingInterface.getCurrentRoundId()).toString()
  );

  assert.equal(getAdminPendingRequests(await votingInterface.getPendingRequests()).length, 0); // There should be no pending requests as vote is concluded

  // Sanity check that prices are available now for Admin requests
  for (let i = 0; i < requestsToVoteOn.length; i++) {
    const hasPrice = await voting.hasPrice(requestsToVoteOn[i].identifier, requestsToVoteOn[i].time, {
      from: governor.address,
    });
    assert(
      hasPrice,
      `Request with identifier ${requestsToVoteOn[i].identifier} and time ${requestsToVoteOn[i].time} has no price`
    );
  }
  /** *******************************************************************
   * 4) Execute proposal submitted to governor now that voting is done *
   **********************************************************************/

  console.log("4. EXECUTING GOVERNOR PROPOSALS");
  for (let proposalIndex = pendingRequests.length; proposalIndex > 0; proposalIndex--) {
    const proposalId = (await governor.numProposals()).subn(proposalIndex).toString(); // most recent proposal in voting.sol
    const proposal = await governor.getProposal(proposalId);
    // for every transactions within the proposal
    for (let i = 0; i < proposal.transactions.length; i++) {
      console.log("Submitting tx", i, "from proposal", proposalIndex - 1, "...");
      let tx = await governor.executeProposal(proposalId.toString(), i.toString(), {
        from: foundationWallet,
        gas: 2000000,
      });
      console.log("Transaction", i, "from proposal", proposalIndex - 1, "submitted! tx", tx.tx);
    }
  }

  console.log("5. GOVERNOR TRANSACTIONS SUCCESSFULLY EXECUTED🎉!");

  if (argv.revert) {
    console.log("SCRIPT DONE...REVERTING STATE...", snapshotId);
    await revertToSnapshot(web3, snapshotId);
  }
}

const run = async function (callback) {
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
