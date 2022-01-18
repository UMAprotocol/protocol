// Description:
// - Simulate voting affirmatively on any pending Admin Proposals

// Run:
// - Start mainnet fork in one window with `yarn hardhat node --fork <ARCHIVAL_NODE_URL> --no-deploy --port 9545`
// - Next, open another terminal window and run `./packages/scripts/setupFork.sh` to unlock
//   accounts on the local node that we'll need to run this script.
// - This script should be run after any Admin proposal UMIP script against a local Mainnet fork. It allows the tester
//   to simulate what would happen if the proposal were to pass and to verify that contract state changes as expected.
// - Vote Simulate: node ./packages/scripts/src/admin-proposals/simulateVote.js --network mainnet-fork

const hre = require("hardhat");
const { getContract } = hre;
require("dotenv").config();
const assert = require("assert");
const { GasEstimator } = require("@uma/financial-templates-lib");
const winston = require("winston");
const {
  interfaceName,
  advanceBlockAndSetTime,
  isAdminRequest,
  getRandomSignedInt,
  computeVoteHash,
  signMessage,
} = require("@uma/common");
const { _getContractAddressByName, _setupWeb3 } = require("../utils");
const { REQUIRED_SIGNER_ADDRESSES, YES_VOTE, SECONDS_PER_DAY, SNAPSHOT_MESSAGE } = require("../utils/constants");
const argv = require("minimist")(process.argv.slice(), {
  boolean: [
    // set to True to not execute any proposals after voting on them
    "skipExecute",
  ],
  default: { skipExecute: false },
});

async function run() {
  // Set up provider so that we can sign from special wallets. This script is designed to only run against local mainnet
  // forks.
  const { netId, web3 } = await _setupWeb3();
  const accounts = await web3.eth.getAccounts();

  // Contract ABI's
  const Governor = getContract("Governor");
  const Finder = getContract("Finder");
  const Voting = getContract("Voting");
  const VotingInterface = getContract("VotingInterface");

  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  const gasEstimator = new GasEstimator(
    winston.createLogger({ silent: true }),
    60, // Time between updates.
    netId
  );
  await gasEstimator.update();
  console.log(
    `⛽️ Current fast gas price for Ethereum: ${web3.utils.fromWei(
      gasEstimator.getCurrentFastPrice().maxFeePerGas.toString(),
      "gwei"
    )} maxFeePerGas and ${web3.utils.fromWei(
      gasEstimator.getCurrentFastPrice().maxPriorityFeePerGas.toString(),
      "gwei"
    )} maxPriorityFeePerGas`
  );
  const governor = new web3.eth.Contract(Governor.abi, await _getContractAddressByName("Governor", netId));
  const finder = new web3.eth.Contract(Finder.abi, await _getContractAddressByName("Finder", netId));
  const oracleAddress = await finder.methods
    .getImplementationAddress(web3.utils.utf8ToHex(interfaceName.Oracle))
    .call();
  const oracle = new web3.eth.Contract(Voting.abi, oracleAddress);
  const votingInterface = new web3.eth.Contract(VotingInterface.abi, oracleAddress);
  console.group("\nℹ️  DVM infrastructure for Ethereum transactions:");
  console.log(`- Finder @ ${finder.options.address}`);
  console.log(`- Oracle @ ${oracle.options.address}`);
  console.log(`- Governor @ ${governor.options.address}`);
  console.groupEnd();

  console.group("\n🗳 Simulating Admin Proposal Vote");
  let numProposals = Number(await governor.methods.numProposals().call());
  assert(numProposals >= 1, "Must be at least 1 pending proposal");

  // Fetch current voting round statistics to determine how much time to advance the EVM forward.
  async function _getAndDisplayVotingRoundStats() {
    const numProposals = Number(await governor.methods.numProposals().call());
    assert(numProposals >= 1, "Must be at least 1 pending proposal");
    const pendingRequests = (await votingInterface.methods.getPendingRequests().call()).filter((req) => {
      return isAdminRequest(web3.utils.hexToUtf8(req.identifier));
    });
    const currentTime = Number(await oracle.methods.getCurrentTime().call());
    const votingPhase = Number(await votingInterface.methods.getVotePhase().call());
    const roundId = Number(await oracle.methods.getCurrentRoundId().call());
    console.group(`\n[Round #${roundId}] Voting round stats`);
    console.log(`- Current time: ${currentTime}`);
    console.log(`- Active Admin price requests: ${pendingRequests.length}`);
    console.log(`- Voting phase: ${votingPhase}`);
    console.groupEnd();

    return { currentTime, votingPhase, pendingRequests, roundId };
  }
  console.group("\nCurrent Voting phase stats");
  let votingStats = await _getAndDisplayVotingRoundStats();
  console.groupEnd();

  console.group("\n⏱ Advancing voting phase to next commit phase (i.e. advancing to next voting round)");
  // - If the DVM is currently in the commit phase (0) then we need to advance into the next round by advancing
  // forward by 2 days. Else if we are in the reveal phase (1) then we need to advance into the next round by
  // advancing by one day to take us into the next round.
  if (votingStats.votingPhase === 0) {
    await advanceBlockAndSetTime(web3, votingStats.currentTime + SECONDS_PER_DAY * 2);
  } else {
    await advanceBlockAndSetTime(web3, votingStats.currentTime + SECONDS_PER_DAY);
  }
  votingStats = await _getAndDisplayVotingRoundStats();
  console.groupEnd();
  assert(votingStats.pendingRequests.length >= 1, "Must be at least 1 pending admin price request to vote on");

  // Vote affirmatively from Foundation wallet.
  const requestsToVoteOn = [];
  console.group("\n🏗 Constructing vote hashes");
  for (let i = 0; i < votingStats.pendingRequests.length; i++) {
    const request = votingStats.pendingRequests[i];
    const identifier = request.identifier.toString();
    const time = request.time.toString();
    const price = web3.utils.toWei(YES_VOTE);
    const salt = getRandomSignedInt();
    // Main net DVM uses the commit reveal scheme of hashed concatenation of price and salt
    const voteHashData = {
      price,
      salt: salt.toString(),
      account: REQUIRED_SIGNER_ADDRESSES["foundation"],
      time,
      roundId: votingStats.roundId,
      identifier,
    };
    console.table(voteHashData);
    let voteHash;
    voteHash = computeVoteHash({
      price,
      salt,
      account: REQUIRED_SIGNER_ADDRESSES["foundation"],
      time,
      roundId: votingStats.roundId,
      identifier,
    });
    requestsToVoteOn.push({ identifier, salt, time, price, voteHash });
  }
  console.groupEnd();

  console.group(`\n📝  Commit ${requestsToVoteOn.length} Admin requests`);
  // send the foundation wallet some eth to submit the Tx
  await web3.eth.sendTransaction({
    from: accounts[0],
    to: REQUIRED_SIGNER_ADDRESSES["foundation"],
    value: web3.utils.toWei("10"),
    ...gasEstimator.getCurrentFastPrice(),
  });
  for (let i = 0; i < requestsToVoteOn.length; i++) {
    const request = requestsToVoteOn[i];
    const txn = await votingInterface.methods
      .commitVote(request.identifier, request.time, request.voteHash)
      .send({ from: REQUIRED_SIGNER_ADDRESSES["foundation"], ...gasEstimator.getCurrentFastPrice() });
    console.log(`- [${i + 1}/${requestsToVoteOn.length}] Commit transaction hash: ${txn.transactionHash}`);
  }
  console.groupEnd();

  console.group("\n⏱ Advancing voting phase to reveal phase (i.e. advancing to next voting round)");
  await advanceBlockAndSetTime(web3, votingStats.currentTime + SECONDS_PER_DAY);
  votingStats = await _getAndDisplayVotingRoundStats();
  console.groupEnd();

  console.group("\n📸 Generating a voting token snapshot.");
  let signature = await signMessage(web3, SNAPSHOT_MESSAGE, accounts[0]);
  let snapshotTxn = await votingInterface.methods
    .snapshotCurrentRound(signature)
    .send({ from: accounts[0], ...gasEstimator.getCurrentFastPrice() });
  console.log(`Snapshot transaction hash: ${snapshotTxn.transactionHash}`);
  console.groupEnd();

  console.group(`\n✅ Reveal ${requestsToVoteOn.length} Admin requests`);
  for (let i = 0; i < requestsToVoteOn.length; i++) {
    const request = requestsToVoteOn[i];
    const txn = await votingInterface.methods
      .revealVote(request.identifier, request.time, request.price, request.salt)
      .send({ from: REQUIRED_SIGNER_ADDRESSES["foundation"], ...gasEstimator.getCurrentFastPrice() });
    console.log(`- [${i + 1}/${requestsToVoteOn.length}] Reveal transaction hash: ${txn.transactionHash}`);
  }
  console.groupEnd();

  console.group("\n⏱ Advancing voting phase to conclude vote");
  await advanceBlockAndSetTime(web3, votingStats.currentTime + SECONDS_PER_DAY);
  votingStats = await _getAndDisplayVotingRoundStats();
  console.groupEnd();
  assert.strictEqual(votingStats.pendingRequests.length, 0, "Should be 0 remaining admin price requests");

  // Sanity check that prices are available now for Admin requests
  for (let i = 0; i < requestsToVoteOn.length; i++) {
    const hasPrice = await oracle.methods
      .hasPrice(requestsToVoteOn[i].identifier, requestsToVoteOn[i].time)
      .call({ from: governor.options.address });
    assert(
      hasPrice,
      `Request with identifier ${requestsToVoteOn[i].identifier} and time ${requestsToVoteOn[i].time} has no price`
    );
  }

  if (!argv.skipExecute) {
    // Execute the most recent admin votes that we just passed through.
    console.group("\n📢 Executing Governor Proposals");
    console.group("\nNumber of proposals:", requestsToVoteOn.length);
    for (let i = requestsToVoteOn.length; i > 0; i--) {
      // Set `proposalId` to index of most recent proposal in voting.sol
      const proposalId = Number(await governor.methods.numProposals().call()) - i;
      console.group("\nProposal ID:", proposalId.toString());
      const proposal = await governor.methods.getProposal(proposalId.toString()).call();
      for (let j = 0; j < proposal.transactions.length; j++) {
        console.log(`- Submitting transaction #${j + 1} from proposal #${proposalId}`);
        try {
          let txn = await governor.methods
            .executeProposal(proposalId.toString(), j.toString())
            .send({ from: accounts[0], ...gasEstimator.getCurrentFastPrice() });
          console.log(`    - Success, receipt: ${txn.transactionHash}`);
        } catch (err) {
          console.error("    - Failure: Txn was likely executed previously, skipping to next one");
          continue;
        }
      }
      console.groupEnd();
    }
    console.groupEnd();
    console.groupEnd();
  }

  console.log("\n😇 Success!");
  console.groupEnd();
}

function main() {
  const startTime = Date.now();
  run()
    .catch((err) => {
      console.error(err);
    })
    .finally(() => {
      const timeElapsed = Date.now() - startTime;
      console.log(`Done in ${(timeElapsed / 1000).toFixed(2)}s`);
    });
}

if (require.main === module) {
  main();
}

module.exports = { run };
