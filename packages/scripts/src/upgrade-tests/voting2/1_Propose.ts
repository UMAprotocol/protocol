// This script generates and submits the upgrade transactions from Voting to VotingV2.
// It is intended to be run after 0_Deploy.ts where the VotingV2 and VotingUpgrader contracts are deployed.
// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// VOTING_UPGRADER_ADDRESS= <VOTING-UPGRADER-ADDRESS> \
// VOTING_V2_ADDRESS= <VOTING-V2-ADDRESS> \
// yarn hardhat run ./src/upgrade-tests/voting2/1_Propose.ts --network localhost

const hre = require("hardhat");

import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import { VotingUpgrader__factory } from "@uma/contracts-frontend/dist/typechain/core/ethers";
import {
  Finder,
  Governor,
  Proposer,
  Voting,
  VotingToken,
  VotingV2__factory,
} from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../../utils/contracts";

const { getContractFactory } = hre.ethers;

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const proposerSigner = await hre.ethers.getSigner(proposerWallet);

  const votingUpgraderAddress = process.env["VOTING_UPGRADER_ADDRESS"];
  const votingV2Address = process.env["VOTING_V2_ADDRESS"];

  if (!votingV2Address) throw new Error("VOTING_V2_ADDRESS not set");
  if (!votingUpgraderAddress) throw new Error("VOTING_UPGRADER_ADDRESS not set");

  console.log("Running Voting Upgrade🔥");
  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const proposer = await getContractInstance<Proposer>("Proposer");
  const existingVoting = await getContractInstance<Voting>("Voting");
  const votingToken = await getContractInstance<VotingToken>("VotingToken");

  const votingV2Factory: VotingV2__factory = await getContractFactory("VotingV2");
  const votingV2 = await votingV2Factory.attach(votingV2Address);

  const votingUpgraderFactory: VotingUpgrader__factory = await getContractFactory("VotingUpgrader");
  const votingUpgrader = await votingUpgraderFactory.attach(votingUpgraderAddress);

  const adminProposalTransactions: {
    to: string;
    value: BigNumberish;
    data: BytesLike;
  }[] = [];

  console.log("2. TRANSFERRING OWNERSHIP OF NEW VOTING TO GOVERNOR");

  await votingV2.transferOwnership(governor.address);

  console.log("3. CRAFTING GOVERNOR TRANSACTIONS");

  // Add VotingV2 contract as a minter, so rewards can be minted in the existing token.
  // Note: this transaction must come before the owner is moved to the new Governor.
  const minter = "1";
  const addVotingAsTokenMinterTx = await votingToken.populateTransaction.addMember(minter, votingV2.address);
  if (!addVotingAsTokenMinterTx.data) throw "addVotingAsTokenMinterTx.data is null";
  adminProposalTransactions.push({ to: votingToken.address, value: 0, data: addVotingAsTokenMinterTx.data });
  console.log("3.a. Add minting roll to new voting contract:", addVotingAsTokenMinterTx.data);

  const transferFinderOwnershipTx = await finder.populateTransaction.transferOwnership(votingUpgrader.address);
  if (!transferFinderOwnershipTx.data) throw "transferFinderOwnershipTx.data is null";
  adminProposalTransactions.push({ to: finder.address, value: 0, data: transferFinderOwnershipTx.data });
  console.log("3.b. Transfer ownership of finder to voting upgrader:", transferFinderOwnershipTx.data);

  const transferExistingVotingOwnershipTx = await existingVoting.populateTransaction.transferOwnership(
    votingUpgrader.address
  );
  if (!transferExistingVotingOwnershipTx.data) throw "transferExistingVotingOwnershipTx.data is null";
  adminProposalTransactions.push({
    to: existingVoting.address,
    value: 0,
    data: transferExistingVotingOwnershipTx.data,
  });
  console.log("3.c. Transfer ownership of existing voting to voting upgrader:", transferExistingVotingOwnershipTx.data);

  const upgraderExecuteUpgradeTx = await votingUpgrader.populateTransaction.upgrade();
  if (!upgraderExecuteUpgradeTx.data) throw "upgraderExecuteUpgradeTx.data is null";
  adminProposalTransactions.push({ to: votingUpgrader.address, value: 0, data: upgraderExecuteUpgradeTx.data });
  console.log("3.d. Execute upgrade of voting:", upgraderExecuteUpgradeTx.data);

  console.log("4. SENDING PROPOSAL TXS TO GOVERNOR");

  const tx = await proposer.connect(proposerSigner).propose(adminProposalTransactions);

  console.log("Proposal done!🎉");
  console.log("\nProposal data:\n", tx.data);
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
