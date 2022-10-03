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
import { RegistryRolesEnum, ZERO_ADDRESS } from "@uma/common";
import {
  FinderEthers,
  GovernorEthers,
  ProposerEthers,
  ProposerV2Ethers,
  RegistryEthers,
  VotingEthers,
  VotingTokenEthers,
  VotingUpgraderV2Ethers,
  VotingUpgraderV2Ethers__factory,
} from "@uma/contracts-node";

import { getContractInstance } from "../../utils/contracts";
import {
  checkEnvVariables,
  getMultiRoleContracts,
  getOwnableContracts,
  isContractInstance,
  NEW_CONTRACTS,
  OLD_CONTRACTS,
  VOTING_UPGRADER_ADDRESS,
} from "./migrationUtils";
const { getAbi } = require("@uma/contracts-node");

const { getContractFactory } = hre.ethers;

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const proposerSigner = await hre.ethers.getSigner(proposerWallet);

  const networkId = Number(await hre.getChainId());

  checkEnvVariables();

  console.log("Running Voting Upgrade🔥");
  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const finder = await getContractInstance<FinderEthers>("Finder");
  const registry = await getContractInstance<RegistryEthers>("Registry");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  let ownableContractsToMigrate = await getOwnableContracts(networkId);

  const multicallContractsToMigrate = await getMultiRoleContracts(networkId);

  const governor = await getContractInstance<GovernorEthers>("Governor", process.env[OLD_CONTRACTS.governor]);
  const oldVoting = await getContractInstance<VotingEthers>("Voting", process.env[OLD_CONTRACTS.voting]);
  const proposer = await getContractInstance<ProposerEthers>("Proposer", process.env[OLD_CONTRACTS.proposer]);

  const votingV2 = await getContractInstance<VotingEthers>("Voting", process.env[NEW_CONTRACTS.voting]);
  const proposerV2 = await getContractInstance<ProposerEthers>("Proposer", process.env[NEW_CONTRACTS.proposer]);
  const governorV2 = await getContractInstance<GovernorEthers>("Governor", process.env[NEW_CONTRACTS.governor]);

  let votingUpgraderAddress = process.env[VOTING_UPGRADER_ADDRESS];

  if (!votingUpgraderAddress) {
    console.log("1.1 OPTIONAL: DEPLOYING VOTING UPGRADER");
    ownableContractsToMigrate = { ...(await getOwnableContracts(networkId)) };
    ownableContractsToMigrate.proposer = proposer.address;

    const multicallContractsToMigrate = await getMultiRoleContracts(networkId);

    const votingUpgraderFactoryV2: VotingUpgraderV2Ethers__factory = await getContractFactory("VotingUpgraderV2");
    const votingUpgrader = await votingUpgraderFactoryV2.deploy(
      governor.address,
      governorV2.address,
      oldVoting.address,
      votingV2.address,
      finder.address,
      ownableContractsToMigrate,
      multicallContractsToMigrate
    );
    votingUpgraderAddress = votingUpgrader.address;
    console.log("Voting Upgrader deployed to:", votingUpgraderAddress);
  }

  const votingUpgrader = await getContractInstance<VotingUpgraderV2Ethers>("VotingUpgraderV2", votingUpgraderAddress);

  const adminProposalTransactions: {
    to: string;
    value: BigNumberish;
    data: BytesLike;
  }[] = [];

  // If votingV2 is already migrated, remove it
  const migratedAddress = await votingV2.migratedAddress();
  if (migratedAddress != ZERO_ADDRESS) {
    const migrateTx = await votingV2.populateTransaction.setMigrated(ZERO_ADDRESS);
    if (!migrateTx.data) throw "migrateTx.data is null";
    adminProposalTransactions.push({ to: votingV2.address, value: 0, data: migrateTx.data });
    console.log("4.k. Migrate voting contract:", migrateTx.data);
  }

  console.log("2. TRANSFERRING OWNERSHIP OF NEW VOTING TO GOVERNORV2 IF NEEDED");

  const votingV2Owner = await votingV2.owner();

  if (votingV2Owner !== governorV2.address) {
    if ((await votingV2.signer.getAddress()) == votingV2Owner) await votingV2.transferOwnership(governorV2.address);
    if (governor.address == votingV2Owner) {
      adminProposalTransactions.push({
        to: votingV2.address,
        value: 0,
        data: votingV2.interface.encodeFunctionData("transferOwnership", [governorV2.address]),
      });
    }
  }

  console.log("3. TRANSFERRING OWNERSHIP OF NEW PROPOSER TO NEW GOVERNOR IF NEEDED");
  const proposerV2Owner = await proposerV2.owner();
  if (proposerV2Owner !== governorV2.address) {
    if ((await proposerV2.signer.getAddress()) == proposerV2Owner)
      await proposerV2.transferOwnership(governorV2.address);

    if (governor.address == proposerV2Owner) {
      adminProposalTransactions.push({
        to: proposerV2.address,
        value: 0,
        data: proposerV2.interface.encodeFunctionData("transferOwnership", [governorV2.address]),
      });
    }
  }

  console.log("4. CRAFTING GOVERNOR TRANSACTIONS");

  // Add VotingV2 contract as a minter, so rewards can be minted in the existing token.
  // Note: this transaction must come before the owner is moved to the new Governor.
  const minter = "1";
  const addVotingV2AsTokenMinterTx = await votingToken.populateTransaction.addMember(minter, votingV2.address);
  if (!addVotingV2AsTokenMinterTx.data) throw "addVotingV2AsTokenMinterTx.data is null";
  adminProposalTransactions.push({ to: votingToken.address, value: 0, data: addVotingV2AsTokenMinterTx.data });
  console.log("4.a. Add minting roll to new voting contract:", addVotingV2AsTokenMinterTx.data);

  // Add new governor as the owner of the VotingToken contract.
  const addGovernorAsTokenOwnerTx = await votingToken.populateTransaction.resetMember("0", governorV2.address);
  if (!addGovernorAsTokenOwnerTx.data) throw "addGovernorAsTokenOwnerTx.data is null";
  adminProposalTransactions.push({ to: votingToken.address, value: 0, data: addGovernorAsTokenOwnerTx.data });
  console.log("4.b. Add owner roll to new governor contract:", addGovernorAsTokenOwnerTx.data);

  // transfer old governor voting tokens to new governor.
  const transferVotingTokensTx = await votingToken.populateTransaction.transfer(
    governorV2.address,
    await votingToken.balanceOf(governor.address)
  );
  if (!transferVotingTokensTx.data) throw "transferVotingTokensTx.data is null";
  adminProposalTransactions.push({ to: votingToken.address, value: 0, data: transferVotingTokensTx.data });
  console.log("4.c. Transfer voting tokens to new governor contract:", transferVotingTokensTx.data);

  const transferFinderOwnershipTx = await finder.populateTransaction.transferOwnership(votingUpgrader.address);
  if (!transferFinderOwnershipTx.data) throw "transferFinderOwnershipTx.data is null";
  adminProposalTransactions.push({ to: finder.address, value: 0, data: transferFinderOwnershipTx.data });
  console.log("4.d. Transfer ownership of finder to voting upgrader:", transferFinderOwnershipTx.data);

  const transferExistingVotingOwnershipTx = await oldVoting.populateTransaction.transferOwnership(
    votingUpgrader.address
  );
  if (!transferExistingVotingOwnershipTx.data) throw "transferExistingVotingOwnershipTx.data is null";
  adminProposalTransactions.push({
    to: oldVoting.address,
    value: 0,
    data: transferExistingVotingOwnershipTx.data,
  });
  console.log("4.e. Transfer ownership of existing voting to voting upgrader:", transferExistingVotingOwnershipTx.data);

  // Register GovernorV2 and ProposerV2 contracts in the registry if necessary
  const proposerV2Registered = await registry.isContractRegistered(proposerV2.address);
  const governorV2Registered = await registry.isContractRegistered(governorV2.address);
  if (!proposerV2Registered || !governorV2Registered) {
    const addGovernorAsCreatorTx = await registry.populateTransaction.addMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!addGovernorAsCreatorTx.data) throw new Error("addGovernorAsCreatorTx.data is empty");
    adminProposalTransactions.push({ to: registry.address, value: 0, data: addGovernorAsCreatorTx.data });
    console.log("4.f.1 Temporarily add the Governor as a contract creator", addGovernorAsCreatorTx.data);

    if (!proposerV2Registered) {
      const registerProposerV2Tx = await registry.populateTransaction.registerContract([], proposerV2.address);
      if (!registerProposerV2Tx.data) throw new Error("registerProposerV2Tx.data is empty");
      adminProposalTransactions.push({ to: registry.address, value: 0, data: registerProposerV2Tx.data });
      console.log("4.f.2 Register the ProposerV2 as a verified contract", registerProposerV2Tx.data);
    }

    if (!governorV2Registered) {
      const registerGovernorV2Tx = await registry.populateTransaction.registerContract([], governorV2.address);
      if (!registerGovernorV2Tx.data) throw new Error("registerGovernorV2Tx.data is empty");
      adminProposalTransactions.push({ to: registry.address, value: 0, data: registerGovernorV2Tx.data });
      console.log("4.f.3 Register the ProposerV2 as a verified contract", registerGovernorV2Tx.data);
    }

    const removeGovernorAsCreatorTx = await registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!removeGovernorAsCreatorTx.data) throw new Error("removeGovernorAsCreatorTx.data is empty");
    adminProposalTransactions.push({ to: registry.address, value: 0, data: removeGovernorAsCreatorTx.data });
    console.log("4.f.4 Remove the Governor from being a contract creator", removeGovernorAsCreatorTx.data);
  } else {
    console.log("4.f ProposerV2 contract already registered in registry");
  }

  // Transfer Ownable contracts to VotingUpgraderV2
  for (const ownableToMigrate of Object.entries(ownableContractsToMigrate)) {
    const contractAddress = ownableToMigrate[1];
    const contractName = ownableToMigrate[0];
    const iface = new hre.ethers.utils.Interface(getAbi("Ownable"));
    const data = iface.encodeFunctionData("transferOwnership", [votingUpgraderAddress]);
    adminProposalTransactions.push({ to: contractAddress, value: 0, data });
    console.log(`4.g.  Ownable: transfer ownership of ${contractName} to voting upgrader`, data);
  }

  // Transfer Multirole contracts to new VotingUpgraderV2
  for (const multiRoleToMigrate of Object.entries(multicallContractsToMigrate)) {
    const contractAddress = multiRoleToMigrate[1];
    const contractName = multiRoleToMigrate[0];
    const iface = new hre.ethers.utils.Interface(getAbi("MultiRole"));
    const data = iface.encodeFunctionData("resetMember", [0, votingUpgraderAddress]);
    adminProposalTransactions.push({ to: contractAddress, value: 0, data });
    console.log(`4.h.  Multirole: transfer owner role of ${contractName} to voting upgrader`, data);
  }

  const resetMemberGovernorTx = await governor.populateTransaction.resetMember(0, votingUpgraderAddress);
  if (!resetMemberGovernorTx.data) throw "resetMemberGovernorTx.data is null";
  adminProposalTransactions.push({ to: governor.address, value: 0, data: resetMemberGovernorTx.data });
  console.log("4.i.  Reset governor member to voting upgrader:", resetMemberGovernorTx.data);

  const resetMemberNewGovernorTx = await governorV2.populateTransaction.resetMember(0, votingUpgraderAddress);
  if (!resetMemberNewGovernorTx.data) throw "resetMemberNewGovernorTx.data is null";
  adminProposalTransactions.push({ to: governorV2.address, value: 0, data: resetMemberNewGovernorTx.data });

  const upgraderExecuteUpgradeTx = await votingUpgrader.populateTransaction.upgrade();
  if (!upgraderExecuteUpgradeTx.data) throw "upgraderExecuteUpgradeTx.data is null";
  adminProposalTransactions.push({ to: votingUpgrader.address, value: 0, data: upgraderExecuteUpgradeTx.data });
  console.log("4.j. Execute upgrade of voting:", upgraderExecuteUpgradeTx.data);

  console.log("5. SENDING PROPOSAL TXS TO GOVERNOR");

  const defaultBond = await proposer.bond();
  const allowance = await votingToken.allowance(proposerWallet, proposer.address);
  if (allowance.lt(defaultBond)) {
    console.log("5.a. Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposer.address, defaultBond);
    await approveTx.wait();
  }

  const isProposerV1 = await isContractInstance(proposer.address, "propose((address,uint256,bytes)[])");
  let tx;
  if (isProposerV1) {
    tx = await proposer.connect(proposerSigner).propose(adminProposalTransactions);
  } else {
    tx = await (await getContractInstance<ProposerV2Ethers>("ProposerV2", proposer.address))
      .connect(proposerSigner)
      .propose(adminProposalTransactions, hre.web3.utils.utf8ToHex("Admin Proposal"));
  }

  console.log("Proposal done!🎉");
  console.log("\nProposal data:\n", tx.data);

  const isVotingV2 = await isContractInstance(oldVoting.address, "stake(uint256)");
  console.log("\n❓ OPTIONAL: Simulate the approval and execute the proposal with the following command: ");
  if (isVotingV2) {
    console.log(
      `
    ${NEW_CONTRACTS.voting}=${oldVoting.address} \\
    ${NEW_CONTRACTS.governor}=${governor.address} \\
    ${NEW_CONTRACTS.proposer}=${proposer.address} \\
    NODE_URL_1=http://127.0.0.1:9545/ \\
    yarn hardhat run ./src/admin-proposals/simulateVoteV2.ts --network localhost`.replace(/  +/g, "")
    );
  } else {
    console.log(
      "\nNODE_URL_1=http://127.0.0.1:9545/ node ./src/admin-proposals/simulateVote.js --network mainnet-fork \n"
    );
  }

  console.log(
    `
  ✅ VERIFICATION: Verify the proposal execution with the following command:
  ${NEW_CONTRACTS.voting}=${votingV2.address} \\
  ${NEW_CONTRACTS.governor}=${governorV2.address} \\
  ${NEW_CONTRACTS.proposer}=${proposerV2.address} \\
  ${OLD_CONTRACTS.voting}=${oldVoting.address} \\
  ${OLD_CONTRACTS.governor}=${governor.address} \\
  ${OLD_CONTRACTS.proposer}=${proposer.address} \\
  yarn hardhat run ./src/upgrade-tests/voting2/2_Verify.ts --network localhost`.replace(/  +/g, "")
  );
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
