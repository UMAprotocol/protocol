// This script generates and submits the upgrade transactions from Voting to VotingV2.
// It is intended to be run after 0_Deploy.ts where the VotingV2 and VotingUpgrader contracts are deployed.
// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// VOTING_UPGRADER_ADDRESS= <VOTING-UPGRADER-ADDRESS> \
// VOTING_V2_ADDRESS= <VOTING-V2-ADDRESS> \
// GOVERNOR_V2_ADDRESS= <GOVERNOR-V2-ADDRESS> \
// yarn hardhat run ./src/upgrade-tests/voting2/1_Propose.ts --network localhost

const hre = require("hardhat");

import { BigNumberish } from "@ethersproject/bignumber";
import { BytesLike } from "@ethersproject/bytes";
import {
  FinderEthers,
  GovernorEthers,
  ProposerEthers,
  VotingEthers,
  VotingTokenEthers,
  VotingUpgraderV2Ethers__factory,
  VotingV2Ethers__factory,
} from "@uma/contracts-node";

import { getContractInstance } from "../../utils/contracts";
import { getMultiRoleContracts, getOwnableContracts } from "./migrationUtils";
const { getAbi } = require("@uma/contracts-node");

const { getContractFactory } = hre.ethers;

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const proposerSigner = await hre.ethers.getSigner(proposerWallet);

  const networkId = Number(await hre.getChainId());

  const votingUpgraderAddress = process.env["VOTING_UPGRADER_ADDRESS"];
  const votingV2Address = process.env["VOTING_V2_ADDRESS"];
  const governorV2Address = process.env["GOVERNOR_V2_ADDRESS"];

  if (!votingV2Address) throw new Error("VOTING_V2_ADDRESS not set");
  if (!votingUpgraderAddress) throw new Error("VOTING_UPGRADER_ADDRESS not set");
  if (!governorV2Address) throw new Error("GOVERNOR_V2_ADDRESS not set");

  console.log("Running Voting Upgrade🔥");
  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const finder = await getContractInstance<FinderEthers>("Finder");
  const governor = await getContractInstance<GovernorEthers>("Governor");
  const proposer = await getContractInstance<ProposerEthers>("Proposer");
  const existingVoting = await getContractInstance<VotingEthers>("Voting");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const votingV2Factory: VotingV2Ethers__factory = await getContractFactory("VotingV2");
  const votingV2 = await votingV2Factory.attach(votingV2Address);

  const votingUpgraderFactory: VotingUpgraderV2Ethers__factory = await getContractFactory("VotingUpgraderV2");
  const votingUpgrader = await votingUpgraderFactory.attach(votingUpgraderAddress);

  const ownableContractsToMigrate = await getOwnableContracts(networkId);

  const multicallContractsToMigrate = await getMultiRoleContracts(networkId);

  const adminProposalTransactions: {
    to: string;
    value: BigNumberish;
    data: BytesLike;
  }[] = [];

  console.log("2. TRANSFERRING OWNERSHIP OF NEW VOTING TO GOVERNORV2");

  await votingV2.transferOwnership(governorV2Address);

  console.log("3. CRAFTING GOVERNOR TRANSACTIONS");

  // Add VotingV2 contract as a minter, so rewards can be minted in the existing token.
  // Note: this transaction must come before the owner is moved to the new Governor.
  const minter = "1";
  const addVotingV2AsTokenMinterTx = await votingToken.populateTransaction.addMember(minter, votingV2.address);
  if (!addVotingV2AsTokenMinterTx.data) throw "addVotingV2AsTokenMinterTx.data is null";
  adminProposalTransactions.push({ to: votingToken.address, value: 0, data: addVotingV2AsTokenMinterTx.data });
  console.log("3.a. Add minting roll to new voting contract:", addVotingV2AsTokenMinterTx.data);

  // Add new governor as the owner of the VotingToken contract.
  const addGovernorAsTokenOwnerTx = await votingToken.populateTransaction.resetMember("0", governorV2Address);
  if (!addGovernorAsTokenOwnerTx.data) throw "addGovernorAsTokenOwnerTx.data is null";
  adminProposalTransactions.push({ to: votingToken.address, value: 0, data: addGovernorAsTokenOwnerTx.data });
  console.log("3.b. Add owner roll to new governor contract:", addGovernorAsTokenOwnerTx.data);

  const transferFinderOwnershipTx = await finder.populateTransaction.transferOwnership(votingUpgrader.address);
  if (!transferFinderOwnershipTx.data) throw "transferFinderOwnershipTx.data is null";
  adminProposalTransactions.push({ to: finder.address, value: 0, data: transferFinderOwnershipTx.data });
  console.log("3.c. Transfer ownership of finder to voting upgrader:", transferFinderOwnershipTx.data);

  const transferExistingVotingOwnershipTx = await existingVoting.populateTransaction.transferOwnership(
    votingUpgrader.address
  );
  if (!transferExistingVotingOwnershipTx.data) throw "transferExistingVotingOwnershipTx.data is null";
  adminProposalTransactions.push({
    to: existingVoting.address,
    value: 0,
    data: transferExistingVotingOwnershipTx.data,
  });
  console.log("3.d. Transfer ownership of existing voting to voting upgrader:", transferExistingVotingOwnershipTx.data);

  // Transfer Ownable contracts to VotingUpgraderV2
  for (const ownableToMigrate of Object.entries(ownableContractsToMigrate)) {
    const contractAddress = ownableToMigrate[1];
    const contractName = ownableToMigrate[0];
    const iface = new hre.ethers.utils.Interface(getAbi("Ownable"));
    const data = iface.encodeFunctionData("transferOwnership", [votingUpgraderAddress]);
    adminProposalTransactions.push({ to: contractAddress, value: 0, data });
    console.log(`3.e.  Ownable: transfer ownership of ${contractName} to voting upgrader`, data);
  }

  // Transfer Multirole contracts to new VotingUpgraderV2
  for (const multiRoleToMigrate of Object.entries(multicallContractsToMigrate)) {
    const contractAddress = multiRoleToMigrate[1];
    const contractName = multiRoleToMigrate[0];
    const iface = new hre.ethers.utils.Interface(getAbi("MultiRole"));
    const data = iface.encodeFunctionData("resetMember", [0, votingUpgraderAddress]);
    adminProposalTransactions.push({ to: contractAddress, value: 0, data });
    console.log(`3.f.  Multirole: transfer owner role of ${contractName} to voting upgrader`, data);
  }

  const resetMemberGovernorTx = await governor.populateTransaction.resetMember(0, votingUpgraderAddress);
  if (!resetMemberGovernorTx.data) throw "resetMemberGovernorTx.data is null";
  adminProposalTransactions.push({ to: governor.address, value: 0, data: resetMemberGovernorTx.data });
  console.log("3.g.  Reset governor member to voting upgrader:", resetMemberGovernorTx.data);

  const upgraderExecuteUpgradeTx = await votingUpgrader.populateTransaction.upgrade();
  if (!upgraderExecuteUpgradeTx.data) throw "upgraderExecuteUpgradeTx.data is null";
  adminProposalTransactions.push({ to: votingUpgrader.address, value: 0, data: upgraderExecuteUpgradeTx.data });
  console.log("3.h. Execute upgrade of voting:", upgraderExecuteUpgradeTx.data);

  console.log("4. SENDING PROPOSAL TXS TO GOVERNOR");

  const defaultBond = await proposer.bond();
  const allowance = await votingToken.allowance(proposerWallet, proposer.address);
  if (allowance.lt(defaultBond)) {
    console.log("4.a. Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposer.address, defaultBond);
    await approveTx.wait();
  }

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
