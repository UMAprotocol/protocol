// Description:
// - Simulate voting affirmatively on any pending Admin Proposals

import { advanceBlockAndSetTime, computeVoteHashAncillary, getRandomSignedInt, getWeb3ByChainId } from "@uma/common";
import { GovernorV2Ethers, VotingTokenEthers, VotingV2Ethers } from "@uma/contracts-node";
import { BigNumberish, BytesLike } from "ethers";
// import { REQUIRED_SIGNER_ADDRESSES, SECONDS_PER_DAY, YES_VOTE } from "../utils/constants";
import { getContractInstance } from "../utils/contracts";

const SECONDS_PER_DAY = 86400;
const YES_VOTE = "1";
const REQUIRED_SIGNER_ADDRESSES = {
  deployer: "0x2bAaA41d155ad8a4126184950B31F50A1513cE25",
  foundation: "0x7a3A1c2De64f20EB5e916F40D11B01C441b2A8Dc",
  account_with_uma: "0xcb287f69707d84cbd56ab2e7a4f32390fa98120b",
};

// Run:
// - Check out README.md in this folder for setup instructions and simulating votes between the Propose and Verify
//   steps.
// - This script should be run after any Admin proposal UMIP script against a local Mainnet fork. It allows the tester
//   to simulate what would happen if the proposal were to pass and to verify that contract state changes as expected.
// - Vote Simulate: NODE_URL_1=http://localhost:9545 node ./packages/scripts/src/admin-proposals/simulateVoteV2.js --network mainnet-fork

const hre = require("hardhat");
const { toWei } = hre.web3.utils;
require("dotenv").config();
const assert = require("assert").strict;

async function simulateVoteV2() {
  const foundationSigner = await hre.ethers.getSigner(REQUIRED_SIGNER_ADDRESSES["foundation"]);

  const governorV2Address = process.env["GOVERNOR_V2_ADDRESS"];
  const votingV2Address = process.env["VOTING_V2_ADDRESS"];

  const governorV2 = await getContractInstance<GovernorV2Ethers>("GovernorV2", governorV2Address);
  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2", votingV2Address);
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const web3 = getWeb3ByChainId(1);
  const accounts = await web3.eth.getAccounts();

  // Stake foundation balance
  const foundationBalance = await votingToken.balanceOf(REQUIRED_SIGNER_ADDRESSES["foundation"]);
  if (foundationBalance.gt(0)) {
    await votingToken.connect(foundationSigner).approve(votingV2.address, foundationBalance);
    await votingV2.connect(foundationSigner).stake(foundationBalance);
  }
  // Initialize Eth contracts by grabbing deployed addresses from networks/1.json file.
  // const mainnetContracts = await setupMainnet(web3);

  console.group("\n🗳 Simulating Admin Proposal Vote");
  const numProposals = Number(await governorV2.numProposals());
  assert(numProposals >= 1, "Must be at least 1 pending proposal");

  // Fetch current voting round statistics to determine how much time to advance the EVM forward.
  async function _getAndDisplayVotingRoundStats() {
    const numProposals = Number(await governorV2.numProposals());
    assert(numProposals >= 1, "Must be at least 1 pending proposal");
    const pendingRequests = await votingV2.getPendingRequests();
    const currentTime = Number(await votingV2.getCurrentTime());
    const votingPhase = Number(await votingV2.getVotePhase());
    const roundId = Number(await votingV2.getCurrentRoundId());
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
  const requestsToVoteOn: {
    identifier: BytesLike;
    time: BigNumberish;
    salt: BigNumberish;
    ancillaryData: BytesLike;
    price: BigNumberish;
    voteHash: BytesLike;
  }[] = [];
  console.group("\n🏗 Constructing vote hashes");
  for (let i = 0; i < votingStats.pendingRequests.length; i++) {
    const request = votingStats.pendingRequests[i];
    const identifier = request.identifier.toString();
    const time = request.time.toString();
    const price = toWei(YES_VOTE);
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

    const voteHash = computeVoteHashAncillary({
      price,
      salt,
      account: REQUIRED_SIGNER_ADDRESSES["foundation"],
      time,
      roundId: votingStats.roundId,
      identifier,
      ancillaryData: request.ancillaryData,
    });
    requestsToVoteOn.push({
      identifier,
      salt: salt.toString(),
      time,
      price,
      voteHash,
      ancillaryData: request.ancillaryData,
    });
  }
  console.groupEnd();

  console.group(`\n📝  Commit ${requestsToVoteOn.length} Admin requests`);
  // send the foundation wallet some eth to submit the Tx
  await web3.eth.sendTransaction({
    from: accounts[0],
    to: REQUIRED_SIGNER_ADDRESSES["foundation"],
    value: web3.utils.toWei("10"),
  });
  for (let i = 0; i < requestsToVoteOn.length; i++) {
    const request = requestsToVoteOn[i];
    const txn = await votingV2
      .connect(foundationSigner)
      .functions.commitVote(request.identifier, request.time, request.ancillaryData, request.voteHash);
    console.log(`- [${i + 1}/${requestsToVoteOn.length}] Commit transaction hash: ${txn.hash}`);
  }
  console.groupEnd();

  console.group("\n⏱ Advancing voting phase to reveal phase (i.e. advancing to next voting round)");
  await advanceBlockAndSetTime(web3, votingStats.currentTime + SECONDS_PER_DAY);
  votingStats = await _getAndDisplayVotingRoundStats();
  console.groupEnd();

  console.group(`\n✅ Reveal ${requestsToVoteOn.length} Admin requests`);
  for (let i = 0; i < requestsToVoteOn.length; i++) {
    const request = requestsToVoteOn[i];
    const txn = await votingV2
      .connect(foundationSigner)
      .functions.revealVote(request.identifier, request.time, request.price, request.ancillaryData, request.salt);
    console.log(`- [${i + 1}/${requestsToVoteOn.length}] Reveal transaction hash: ${txn.hash}`);
  }
  console.groupEnd();

  console.group("\n⏱ Advancing voting phase to conclude vote");
  await advanceBlockAndSetTime(web3, votingStats.currentTime + SECONDS_PER_DAY);
  votingStats = await _getAndDisplayVotingRoundStats();
  console.groupEnd();
  assert.strictEqual(votingStats.pendingRequests.length, 0, "Should be 0 remaining admin price requests");

  // Sanity check that prices are available now for Admin requests
  for (let i = 0; i < requestsToVoteOn.length; i++) {
    const hasPrice = await votingV2
      .connect(governorV2.address)
      .callStatic["hasPrice(bytes32,uint256,bytes)"](
        requestsToVoteOn[i].identifier,
        requestsToVoteOn[i].time,
        requestsToVoteOn[i].ancillaryData
      );
    assert(
      hasPrice,
      `Request with identifier ${requestsToVoteOn[i].identifier} and time ${requestsToVoteOn[i].time} has no price`
    );
  }

  // Execute the most recent admin votes that we just passed through.
  console.group("\n📢 Executing Governor Proposals");
  console.group("\nNumber of proposals:", requestsToVoteOn.length);
  for (let i = requestsToVoteOn.length; i > 0; i--) {
    // Set `proposalId` to index of most recent proposal in voting.sol
    const proposalId = Number(await governorV2.numProposals()) - i;
    console.group("\nProposal ID:", proposalId.toString());
    const proposal = await governorV2.getProposal(proposalId.toString());
    for (let j = 0; j < proposal.transactions.length; j++) {
      console.log(`- Submitting transaction #${j + 1} from proposal #${proposalId}`);
      try {
        const txn = await governorV2.executeProposal(proposalId.toString(), j.toString(), {
          from: accounts[0],
        });
        console.log(`    - Success, receipt: ${txn.hash}`);
      } catch (err) {
        console.error("    - Failure: Txn was likely executed previously, skipping to next one");
        continue;
      }
    }
    console.groupEnd();
  }
  console.groupEnd();
  console.groupEnd();

  // Unstake all tokens from the foundation wallet.
  console.group("\n📢 Unstaking all tokens from foundation wallet");
  const foundationStakes = await votingV2.voterStakes(REQUIRED_SIGNER_ADDRESSES["foundation"]);
  await votingV2.connect(foundationSigner).requestUnstake(foundationStakes.stake);
  const stakeCooldown = await votingV2.unstakeCoolDown();

  await advanceBlockAndSetTime(web3, (await votingV2.getCurrentTime()).add(stakeCooldown).toNumber());

  await votingV2.connect(foundationSigner).executeUnstake();

  console.log(`Successfully unstaked ${foundationStakes.stake} tokens from foundation wallet`);
  console.groupEnd();

  console.log("\n😇 Success!");
  console.groupEnd();
}

function main() {
  const startTime = Date.now();
  simulateVoteV2()
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

module.exports = { simulateVoteV2 };
