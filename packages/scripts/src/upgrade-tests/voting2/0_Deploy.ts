// This script deploys SlashingLibrary, VotingV2 and VotingUpgrader.
// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// yarn hardhat run ./src/upgrade-tests/voting2/0_Deploy.ts --network localhost

const hre = require("hardhat");

import {
  FinderEthers,
  GovernorEthers,
  GovernorV2Ethers__factory,
  ProposerEthers,
  ProposerV2Ethers__factory,
  SlashingLibraryEthers__factory,
  VotingEthers,
  VotingTokenEthers,
  VotingUpgraderV2Ethers__factory,
  VotingV2Ethers__factory,
} from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";
import { getMultiRoleContracts, getOwnableContracts, NEW_CONTRACTS, VOTING_UPGRADER_ADDRESS } from "./migrationUtils";

const { getContractFactory } = hre.ethers;

async function main() {
  console.log("Running VotingV2 Deployments🔥");

  const networkId = Number(await hre.getChainId());

  const finder = await getContractInstance<FinderEthers>("Finder");
  const governor = await getContractInstance<GovernorEthers>("Governor");
  const proposer = await getContractInstance<ProposerEthers>("Proposer");
  const existingVoting = await getContractInstance<VotingEthers>("Voting");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  console.log("1. DEPLOYING SLASHING LIBRARY");
  const slashingLibraryFactory: SlashingLibraryEthers__factory = await getContractFactory("SlashingLibrary");
  const slashingLibrary = await slashingLibraryFactory.deploy();

  console.log("Deployed SlashingLibrary: ", slashingLibrary.address);

  console.log("2. DEPLOYING VOTING V2");
  const votingV2Factory: VotingV2Ethers__factory = await getContractFactory("VotingV2");
  const emissionRate = "640000000000000000"; // 0.64 UMA per second.
  const spamDeletionProposalBond = hre.web3.utils.toWei("10000", "ether");
  const unstakeCooldown = 60 * 60 * 24 * 7; // 7 days
  const phaseLength = "86400";
  const minRollToNextRoundLength = "7200";
  const gat = hre.web3.utils.toBN(hre.web3.utils.toWei("5500000", "ether")); // Set the GAT to 5.5 million tokens.

  const votingV2 = await votingV2Factory.deploy(
    emissionRate,
    spamDeletionProposalBond,
    unstakeCooldown,
    phaseLength,
    minRollToNextRoundLength,
    gat.toString(),
    "0", // Starting request index of 0 (no offset). TODO change this to the correct number
    votingToken.address,
    finder.address,
    slashingLibrary.address,
    existingVoting.address
  );

  console.log("Deployed VotingV2: ", votingV2.address);

  console.log("3. DEPLOYING GOVERNOR V2");

  const governorV2Factory: GovernorV2Ethers__factory = await getContractFactory("GovernorV2");

  const governorV2 = await governorV2Factory.deploy(finder.address, 0);

  console.log("Deployed GovernorV2: ", governorV2.address);

  console.log("4. DEPLOYING VOTING UPGRADER");

  const ownableContractsToMigrate = await getOwnableContracts(networkId);

  const multicallContractsToMigrate = await getMultiRoleContracts(networkId);

  const votingUpgraderFactoryV2: VotingUpgraderV2Ethers__factory = await getContractFactory("VotingUpgraderV2");
  const votingUpgrader = await votingUpgraderFactoryV2.deploy(
    governor.address,
    governorV2.address,
    existingVoting.address,
    votingV2.address,
    proposer.address,
    finder.address,
    ownableContractsToMigrate,
    multicallContractsToMigrate
  );

  console.log("Deployed VotingUpgrader: ", votingUpgrader.address);

  console.log("5. Deploying ProposerV2");

  const defaultBond = hre.web3.utils.toWei("5000", "ether");

  const proposerFactory: ProposerV2Ethers__factory = await getContractFactory("ProposerV2");
  const proposerV2 = await proposerFactory.deploy(votingToken.address, defaultBond, governorV2.address, finder.address);
  console.log("Deployed ProposerV2: ", proposerV2.address);

  console.log("6. Set ProposerV2 as the proposer of GovernorV2");
  await governorV2.resetMember(1, proposerV2.address);

  console.log("7. Set the old governor as the owner of the new governor");
  // The new governor owner will be updated in the VotingUpgraderV2 contract.
  await governorV2.resetMember(0, governor.address);

  console.log("8. Set the new governor as the owner of the new voting v2");
  await votingV2.transferOwnership(governorV2.address);

  console.log("Deployment done!🎉");

  console.log("Next step, Propose migration: ");
  console.log(
    `
  ☝️ PROPOSAL: Run the following command to propose the migration to VotingV2, GovernorV2 and ProposerV2:
  ${VOTING_UPGRADER_ADDRESS}=${votingUpgrader.address} \\
  ${NEW_CONTRACTS.voting}=${votingV2.address} \\
  ${NEW_CONTRACTS.governor}=${governorV2.address} \\
  ${NEW_CONTRACTS.proposer}=${proposerV2.address} \\
  yarn hardhat run ./src/upgrade-tests/voting2/1_Propose.ts --network localhost`.replace(/  +/g, "")
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
