// This script generates and submits the upgrade transactions from Voting, Governor and Proposer to VotingV2, GovernorV2
// and ProposerV2. It is intended to be run after 0_Deploy.ts where the VotingV2, VotingUpgrader, ProposerV2 and GovernorV2
// contracts are deployed.
// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// TEST_DOWNGRADE=<OPTIONAL-RUN-TEST-DOWNGRADE-TRANSACTIONS> \
// GCKMS_WALLET=<OPTIONAL-GCKMS-WALLET> \
// EMERGENCY_PROPOSAL=<OPTIONAL-RUN-EMERGENCY-PROPOSAL> \
// VOTING_ADDRESS=<OPTONAL-VOTING-ADDRESS>\
// VOTING_V2_ADDRESS=<VOTING-V2-ADDRESS> \
// EMERGENCY_PROPOSER_ADDRESS=<EMERGENCY-PROPOSER-ADDRESS> \
// EMERGENCY_EXECUTOR=<EMERGENCY-EXECUTOR-ADDRESS> \
// GOVERNOR_ADDRESS=<OPTIONAL-GOVERNOR-ADDRESS> \
// GOVERNOR_V2_ADDRESS=<GOVERNOR-V2-ADDRESS> \
// PROPOSER_ADDRESS=<OPTIONAL-PROPOSER-ADDRESS> \
// PROPOSER_V2_ADDRESS=<PROPOSER-V2-ADDRESS> \
// yarn hardhat run ./src/upgrade-tests/voting2/1_Propose.ts --network <network>

const hre = require("hardhat");

import { RegistryRolesEnum } from "@uma/common";
import {
  FinderEthers,
  GovernorEthers,
  ProposerEthers,
  ProposerV2Ethers,
  RegistryEthers,
  VotingEthers,
  VotingTokenEthers,
  VotingUpgraderV2Ethers,
} from "@uma/contracts-node";

import { getContractInstance } from "../../utils/contracts";
import {
  AdminProposalTransaction,
  checkEnvVariables,
  deployVotingUpgraderAndRunDowngradeOptionalTx,
  EMERGENCY_EXECUTOR,
  EMERGENCY_PROPOSAL,
  formatIndentation,
  getMultiRoleContracts,
  getOwnableContracts,
  isGovernorV2Instance,
  isProposerV1Instance,
  isVotingV2Instance,
  NEW_CONTRACTS,
  OLD_CONTRACTS,
  proposeEmergency,
  TEST_DOWNGRADE,
  VOTING_UPGRADER_ADDRESS,
} from "./migrationUtils";
import { getAbi } from "@uma/contracts-node";
import { Signer, Wallet } from "ethers";
import { getGckmsSigner } from "@uma/common";
import { Provider } from "@ethersproject/abstract-provider";

const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

  let proposerSigner: Signer;

  if (process.env.GCKMS_WALLET) {
    proposerSigner = ((await getGckmsSigner()) as Wallet).connect(hre.ethers.provider as Provider);
    if (proposerWallet.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    proposerSigner = (await hre.ethers.getSigner(proposerWallet)) as Signer;
  }

  const networkId = Number(await hre.getChainId());

  // Check that the required environment variables are set.
  checkEnvVariables();

  console.log("Running Voting Upgrade🔥");
  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const finder = await getContractInstance<FinderEthers>("Finder");
  const registry = await getContractInstance<RegistryEthers>("Registry");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const ownableContractsToMigrate = await getOwnableContracts(networkId);

  const multicallContractsToMigrate = await getMultiRoleContracts(networkId);

  const governor = await getContractInstance<GovernorEthers>("Governor", process.env[OLD_CONTRACTS.governor]);
  const oldVoting = await getContractInstance<VotingEthers>("Voting", process.env[OLD_CONTRACTS.voting]);
  const proposer = await getContractInstance<ProposerEthers>("Proposer", process.env[OLD_CONTRACTS.proposer]);

  const votingV2 = await getContractInstance<VotingEthers>("Voting", process.env[NEW_CONTRACTS.voting]);
  const proposerV2 = await getContractInstance<ProposerEthers>("Proposer", process.env[NEW_CONTRACTS.proposer]);
  const governorV2 = await getContractInstance<GovernorEthers>("Governor", process.env[NEW_CONTRACTS.governor]);

  let votingUpgrader;

  if (process.env[TEST_DOWNGRADE]) {
    if (!process.env[EMERGENCY_EXECUTOR]) throw new Error("Must provide EMERGENCY_EXECUTOR");
    votingUpgrader = await deployVotingUpgraderAndRunDowngradeOptionalTx(
      String(process.env[EMERGENCY_EXECUTOR]),
      adminProposalTransactions,
      governor,
      governorV2,
      proposer,
      proposerV2,
      votingV2,
      oldVoting,
      finder,
      ownableContractsToMigrate,
      multicallContractsToMigrate
    );
  } else {
    const votingUpgraderAddress = process.env[VOTING_UPGRADER_ADDRESS];
    if (!votingUpgraderAddress) throw new Error("Must provide VOTING_UPGRADER_ADDRESS");
    votingUpgrader = await getContractInstance<VotingUpgraderV2Ethers>("VotingUpgraderV2", votingUpgraderAddress);
  }

  console.log("2. CRAFTING GOVERNOR TRANSACTIONS");

  const votingUpgraderValidateTxSender = await votingUpgrader.populateTransaction.canRun();
  if (!votingUpgraderValidateTxSender.data) throw "votingUpgraderValidateTxSender.data is null";
  adminProposalTransactions.push({
    to: votingUpgrader.address,
    value: 0,
    data: votingUpgraderValidateTxSender.data,
  });
  console.log("2.a Validate VotingUpgrader sender:", votingUpgraderValidateTxSender.data);

  // Add VotingV2 contract as a minter, so rewards can be minted in the existing token.
  // Note: this transaction must come before the owner is moved to the new Governor.
  const minter = "1";
  const addVotingV2AsTokenMinterTx = await votingToken.populateTransaction.addMember(minter, votingV2.address);
  if (!addVotingV2AsTokenMinterTx.data) throw "addVotingV2AsTokenMinterTx.data is null";
  adminProposalTransactions.push({ to: votingToken.address, value: 0, data: addVotingV2AsTokenMinterTx.data });
  console.log("2.b. Add minting roll to new voting contract:", addVotingV2AsTokenMinterTx.data);

  // Add new governor as the owner of the VotingToken contract.
  const addGovernorAsTokenOwnerTx = await votingToken.populateTransaction.resetMember("0", governorV2.address);
  if (!addGovernorAsTokenOwnerTx.data) throw "addGovernorAsTokenOwnerTx.data is null";
  adminProposalTransactions.push({ to: votingToken.address, value: 0, data: addGovernorAsTokenOwnerTx.data });
  console.log("2.c. Add owner roll to new governor contract:", addGovernorAsTokenOwnerTx.data);

  // transfer old governor voting tokens to new governor.
  const transferVotingTokensTx = await votingToken.populateTransaction.transfer(
    governorV2.address,
    await votingToken.balanceOf(governor.address)
  );
  if (!transferVotingTokensTx.data) throw "transferVotingTokensTx.data is null";
  adminProposalTransactions.push({ to: votingToken.address, value: 0, data: transferVotingTokensTx.data });
  console.log("2.d. Transfer voting tokens to new governor contract:", transferVotingTokensTx.data);

  const transferFinderOwnershipTx = await finder.populateTransaction.transferOwnership(votingUpgrader.address);
  if (!transferFinderOwnershipTx.data) throw "transferFinderOwnershipTx.data is null";
  adminProposalTransactions.push({ to: finder.address, value: 0, data: transferFinderOwnershipTx.data });
  console.log("2.e. Transfer ownership of finder to voting upgrader:", transferFinderOwnershipTx.data);

  const transferExistingVotingOwnershipTx = await oldVoting.populateTransaction.transferOwnership(
    votingUpgrader.address
  );
  if (!transferExistingVotingOwnershipTx.data) throw "transferExistingVotingOwnershipTx.data is null";
  adminProposalTransactions.push({
    to: oldVoting.address,
    value: 0,
    data: transferExistingVotingOwnershipTx.data,
  });
  console.log("2.f. Transfer ownership of existing voting to voting upgrader:", transferExistingVotingOwnershipTx.data);

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
    console.log("4.g.1 Temporarily add the Governor as a contract creator", addGovernorAsCreatorTx.data);

    if (!proposerV2Registered) {
      const registerProposerV2Tx = await registry.populateTransaction.registerContract([], proposerV2.address);
      if (!registerProposerV2Tx.data) throw new Error("registerProposerV2Tx.data is empty");
      adminProposalTransactions.push({ to: registry.address, value: 0, data: registerProposerV2Tx.data });
      console.log("4.h.2 Register the ProposerV2 as a verified contract", registerProposerV2Tx.data);
    }

    if (!governorV2Registered) {
      const registerGovernorV2Tx = await registry.populateTransaction.registerContract([], governorV2.address);
      if (!registerGovernorV2Tx.data) throw new Error("registerGovernorV2Tx.data is empty");
      adminProposalTransactions.push({ to: registry.address, value: 0, data: registerGovernorV2Tx.data });
      console.log("4.h.3 Register the GovernorV2 as a verified contract", registerGovernorV2Tx.data);
    }

    const removeGovernorAsCreatorTx = await registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!removeGovernorAsCreatorTx.data) throw new Error("removeGovernorAsCreatorTx.data is empty");
    adminProposalTransactions.push({ to: registry.address, value: 0, data: removeGovernorAsCreatorTx.data });
    console.log("4.h.4 Remove the Governor from being a contract creator", removeGovernorAsCreatorTx.data);
  } else {
    console.log("2.h ProposerV2 contract already registered in registry");
  }

  // Transfer Ownable contracts to VotingUpgraderV2
  for (const ownableToMigrate of Object.entries(ownableContractsToMigrate)) {
    const contractAddress = ownableToMigrate[1];
    const contractName = ownableToMigrate[0];
    const iface = new hre.ethers.utils.Interface(getAbi("Ownable"));
    const data = iface.encodeFunctionData("transferOwnership", [votingUpgrader.address]);
    adminProposalTransactions.push({ to: contractAddress, value: 0, data });
    console.log(`2.i.  Ownable: transfer ownership of ${contractName} to voting upgrader`, data);
  }

  // Transfer proposer to VotingUpgrader
  const transferProposerOwnershipTx = await proposer.populateTransaction.transferOwnership(votingUpgrader.address);
  if (!transferProposerOwnershipTx.data) throw "transferProposerOwnershipTx.data is null";
  adminProposalTransactions.push({ to: proposer.address, value: 0, data: transferProposerOwnershipTx.data });
  console.log("2.i. Transfer ownership of proposer to voting upgrader:", transferProposerOwnershipTx.data);

  // Transfer Multirole contracts to new VotingUpgraderV2
  for (const multiRoleToMigrate of Object.entries(multicallContractsToMigrate)) {
    const contractAddress = multiRoleToMigrate[1];
    const contractName = multiRoleToMigrate[0];
    const iface = new hre.ethers.utils.Interface(getAbi("MultiRole"));
    const data = iface.encodeFunctionData("resetMember", [0, votingUpgrader.address]);
    adminProposalTransactions.push({ to: contractAddress, value: 0, data });
    console.log(`2.j.  Multirole: transfer owner role of ${contractName} to voting upgrader`, data);
  }

  const resetProposerGovernorTx = await governor.populateTransaction.resetMember(1, governorV2.address);
  if (!resetProposerGovernorTx.data) throw "resetProposerGovernorTx.data is null";
  adminProposalTransactions.push({ to: governor.address, value: 0, data: resetProposerGovernorTx.data });
  console.log("2.k.  Reset governor proposer to governor v2:", resetProposerGovernorTx.data);

  if ((await governorV2.getMember(1)) != proposerV2.address) {
    if (!process.env[TEST_DOWNGRADE]) throw "ProposerV2 is not registered in GovernorV2";
    // This should only happen in the test downgrade script.
    const resetProposerNewGovernorTx = await governorV2.populateTransaction.resetMember(1, proposerV2.address);
    if (!resetProposerNewGovernorTx.data) throw "resetProposerNewGovernorTx.data is null";
    adminProposalTransactions.push({ to: governorV2.address, value: 0, data: resetProposerNewGovernorTx.data });
    console.log("2.k.a  Reset new governor proposer to proposer v2:", resetProposerNewGovernorTx.data);
  }

  const resetMemberGovernorTx = await governor.populateTransaction.resetMember(0, votingUpgrader.address);
  if (!resetMemberGovernorTx.data) throw "resetMemberGovernorTx.data is null";
  adminProposalTransactions.push({ to: governor.address, value: 0, data: resetMemberGovernorTx.data });
  console.log("2.l.  Reset governor owner to voting upgrader:", resetMemberGovernorTx.data);

  const resetMemberNewGovernorTx = await governorV2.populateTransaction.resetMember(0, votingUpgrader.address);
  if (!resetMemberNewGovernorTx.data) throw "resetMemberNewGovernorTx.data is null";
  adminProposalTransactions.push({ to: governorV2.address, value: 0, data: resetMemberNewGovernorTx.data });
  console.log("2.m.  Reset new governor owner to voting upgrader:", resetMemberNewGovernorTx.data);

  const upgraderExecuteUpgradeTx = await votingUpgrader.populateTransaction.upgrade();
  if (!upgraderExecuteUpgradeTx.data) throw "upgraderExecuteUpgradeTx.data is null";
  adminProposalTransactions.push({ to: votingUpgrader.address, value: 0, data: upgraderExecuteUpgradeTx.data });
  console.log("2.n. Execute upgrade of voting:", upgraderExecuteUpgradeTx.data);

  const isGovernorV2 = await isGovernorV2Instance(governor.address);

  const verificationCommand = formatIndentation(`
    ✅ VERIFICATION: Verify the proposal execution with the following command:
  
    ${NEW_CONTRACTS.voting}=${votingV2.address} \\
    ${NEW_CONTRACTS.governor}=${governorV2.address} \\
    ${NEW_CONTRACTS.proposer}=${proposerV2.address} \\
    ${NEW_CONTRACTS.emergencyProposer}=${process.env[NEW_CONTRACTS.emergencyProposer]} \\
    ${EMERGENCY_EXECUTOR}=${process.env[EMERGENCY_EXECUTOR]} \\
    ${OLD_CONTRACTS.voting}=${oldVoting.address} \\
    ${OLD_CONTRACTS.governor}=${governor.address} \\
    ${OLD_CONTRACTS.proposer}=${proposer.address} \\
    yarn hardhat run ./src/upgrade-tests/voting2/2_Verify.ts --network ${hre.network.name}`);

  if (
    isGovernorV2 &&
    process.env[TEST_DOWNGRADE] &&
    process.env[EMERGENCY_PROPOSAL] &&
    process.env[NEW_CONTRACTS.emergencyProposer]
  )
    return proposeEmergency(
      process.env[NEW_CONTRACTS.emergencyProposer] || "",
      votingToken,
      adminProposalTransactions
    ).then(() => console.log(verificationCommand));

  const defaultBond = await proposer.bond();
  const allowance = await votingToken.allowance(proposerWallet, proposer.address);
  if (allowance.lt(defaultBond)) {
    console.log("3.a. Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposer.address, defaultBond);
    await approveTx.wait();
  }

  const isProposerV1 = await isProposerV1Instance(proposer.address);
  let tx;
  if (isProposerV1) {
    console.log("3. SENDING PROPOSAL TXS TO GOVERNOR");
    tx = await proposer.connect(proposerSigner).propose(adminProposalTransactions);
  } else {
    console.log("3. SENDING PROPOSAL TXS TO GOVERNOR V2");
    tx = await (await getContractInstance<ProposerV2Ethers>("ProposerV2", proposer.address))
      .connect(proposerSigner)
      .propose(adminProposalTransactions, hre.ethers.utils.toUtf8Bytes("Admin Proposal"));
  }

  await tx.wait();

  console.log("Proposal done!🎉");
  console.log("\nProposal data:\n", tx.data);

  const isVotingV2 = await isVotingV2Instance(oldVoting.address);
  console.log("\n❓ OPTIONAL: Simulate the approval and execute the proposal with the following command: ");
  if (isVotingV2) {
    console.log(
      formatIndentation(`
    ${NEW_CONTRACTS.voting}=${oldVoting.address} \\
    ${NEW_CONTRACTS.governor}=${governor.address} \\
    ${NEW_CONTRACTS.proposer}=${proposer.address} \\
    EXECUTOR_ADDRESS=${await votingUpgrader.upgrader()} \\
    NODE_URL_1=http://127.0.0.1:9545/ \\
    yarn hardhat run ./src/admin-proposals/simulateVoteV2.ts --network localhost`)
    );
  } else {
    console.log(
      "\nNODE_URL_1=http://127.0.0.1:9545/ node ./src/admin-proposals/simulateVote.js --network localhost \n"
    );
  }

  console.log(verificationCommand);
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
