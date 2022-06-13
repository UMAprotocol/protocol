// This script simulates a vote from a large token holder to ratify the proposal from script 1_Propose.ts.
// It is intended to be run on a main-net Hardhat fork. Leading on from the previous script run a hardhat node
// instance as:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// then run the script as:
// yarn hardhat run ./scripts/simulations/optimistic-oracle-umip/2_VoteSimulate.ts --network localhost

const hre = require("hardhat");

const assert = require("assert").strict;
import { BigNumber, Signer } from "ethers/lib/ethers";
import Web3 from "web3";
import { Governor, Voting, VotingInterface } from "../../../contract-types/ethers";
const {
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

const getAddress = async (contractName: string): Promise<string> => {
  const networkId = await hre.getChainId();
  const addresses = require(`../../../networks/${networkId}.json`);
  return addresses.find((a: { [k: string]: string }) => a.contractName === contractName).address;
};

const getContractInstance = async <T>(contractName: string): Promise<T> => {
  const factory = await hre.ethers.getContractFactory(contractName);
  return (await factory.attach(await getAddress(contractName))) as T;
};

interface PendingRequest {
  identifier: string;
  time: BigNumber;
  ancillaryData: string;
}

async function impersonateAccount(account: string): Promise<Signer> {
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [account] });
  return hre.ethers.getSigner(account);
}

function getAdminPendingRequests(requests: PendingRequest[], web3: Web3) {
  return requests.filter((request) => {
    return isAdminRequest(web3.utils.hexToUtf8(request.identifier));
  });
}

async function main() {
  console.log("Running Upgrade vote simulator🔥");

  console.log("Running Upgrade vote simulator🔥");
  const snapshot = await takeSnapshot(hre.web3);
  const snapshotId = snapshot["result"];
  console.log("Snapshotting starting state...", snapshotId);

  /** *********************************
   * 0) Initial setup                *
   ***********************************/

  console.log("0. SETUP PHASE");
  const foundationSigner = await impersonateAccount(foundationWallet);

  const governor = await getContractInstance<Governor>("Governor");
  const voting = await getContractInstance<Voting>("Voting");
  const votingInterface = (await hre.ethers.getContractAt(
    "VotingInterface",
    await getAddress("Voting")
  )) as VotingInterface;

  const signers: Signer[] = await hre.ethers.getSigners();

  let currentTime = (await voting.getCurrentTime()).toNumber();
  const votingPhase = await votingInterface.getVotePhase();

  const secondsPerDay = 86400;
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
    await advanceBlockAndSetTime(hre.web3, currentTime + secondsPerDay * 2);
  } else {
    await advanceBlockAndSetTime(hre.web3, currentTime + secondsPerDay);
  }

  console.log(
    "⏱  Advancing time by one phase to enable voting by the DVM\nNew timestamp",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    await voting.getVotePhase(),
    "CurrentRoundId",
    (await voting.getCurrentRoundId()).toString()
  );
  console.log(`Checking pending requests for Voting contract @ ${voting.address}`);
  // Note: `getPendingRequests()` returns unexpected data if `Voting` is not on the current version.
  // This is because the `getPendingRequests` method on Voting has changed its ABI to return a
  // `PendingRequestAncillary` struct which is new to the latest ABI.
  const pendingRequests = getAdminPendingRequests(await votingInterface.getPendingRequests(), hre.web3);
  assert(pendingRequests.length >= 1); // there should be at least one pending request

  /** *****************************************************
   * 2) Build vote tx from the foundation wallet         *
   *******************************************************/

  const currentRoundId = (await votingInterface.getCurrentRoundId()).toString();
  const requestsToVoteOn = [];

  for (let pendingIndex = 0; pendingIndex < pendingRequests.length; pendingIndex++) {
    const identifier = pendingRequests[pendingIndex].identifier.toString();
    const time = pendingRequests[pendingIndex].time.toString();
    const price = Web3.utils.toWei("1"); // a "yes" vote

    const salt = BigNumber.from(123);
    // Main net DVM uses the old commit reveal scheme of hashed concatenation of price and salt
    const request = pendingRequests[pendingIndex];
    const voteHash = computeVoteHash({
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
  await signers[0].sendTransaction({
    to: foundationWallet,
    value: Web3.utils.toWei("1"),
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
    const VoteTx = await votingInterface
      .connect(foundationSigner)
      .commitVote(request.identifier, request.time, request.voteHash, {
        gasLimit: 2000000,
      });
    console.log("Voting Tx done!", VoteTx.hash);
  }

  /** *****************************************************
   * 4) Advance to the next phase & reveal the vote      *
   *******************************************************/
  console.log("3. REVEALING FOUNDATION VOTE");
  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(hre.web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to enable reveal\nNew timestamp:",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    await votingInterface.getVotePhase(),
    "currentRoundId",
    (await votingInterface.getCurrentRoundId()).toString()
  );

  console.log("📸 Generating a voting token snapshot.");
  const snapshotMessage = "Sign For Snapshot";
  const signature = await signMessage(hre.web3, snapshotMessage, await signers[0].getAddress());
  await votingInterface.snapshotCurrentRound(signature, { gasLimit: 2000000 });

  for (let i = 0; i < pendingRequests.length; i++) {
    const request = requestsToVoteOn[i];

    const revealTx = await votingInterface
      .connect(foundationSigner)
      .revealVote(request.identifier, request.time, request.price, request.salt, {
        gasLimit: 2000000,
      });
    console.log("Reveal Tx done!", revealTx.hash);
  }

  currentTime = (await voting.getCurrentTime()).toNumber();
  await advanceBlockAndSetTime(hre.web3, currentTime + secondsPerDay);

  console.log(
    "⏱  Advancing time to move to next voting round to conclude vote\nNew timestamp:",
    (await voting.getCurrentTime()).toString(),
    "voting phase",
    await votingInterface.getVotePhase(),
    "currentRoundId",
    (await votingInterface.getCurrentRoundId()).toString()
  );

  assert.equal(getAdminPendingRequests(await votingInterface.getPendingRequests(), hre.web3).length, 0); // There should be no pending requests as vote is concluded

  // Sanity check that prices are available now for Admin requests
  for (let i = 0; i < requestsToVoteOn.length; i++) {
    const governorSigner = await impersonateAccount(governor.address);
    const hasPrice = await voting
      .connect(governorSigner)
      .functions["hasPrice(bytes32,uint256)"](requestsToVoteOn[i].identifier, requestsToVoteOn[i].time, {
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
    const proposalId = (await governor.numProposals()).sub(proposalIndex).toString(); // most recent proposal in voting.sol
    const proposal = await governor.getProposal(proposalId);
    // for every transactions within the proposal
    for (let i = 0; i < proposal.transactions.length; i++) {
      console.log("Submitting tx", i, "from proposal", proposalIndex - 1, "...");
      const tx = await governor.connect(foundationSigner).executeProposal(proposalId.toString(), i.toString(), {
        from: foundationWallet,
        gasLimit: 2000000,
      });
      console.log("Transaction", i, "from proposal", proposalIndex - 1, "submitted! tx", tx.hash);
    }
  }

  console.log("5. GOVERNOR TRANSACTIONS SUCCESSFULLY EXECUTED🎉!");

  if (argv.revert) {
    console.log("SCRIPT DONE...REVERTING STATE...", snapshotId);
    await revertToSnapshot(hre.web3, snapshotId);
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
