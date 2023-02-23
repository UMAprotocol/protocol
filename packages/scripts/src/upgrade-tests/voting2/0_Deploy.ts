// This script deploys SlashingLibrary, VotingV2, GovernorV2, ProposerV2, EmergencyProposer and VotingUpgrader.
// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// yarn hardhat run ./src/upgrade-tests/voting2/0_Deploy.ts --network localhost

const hre = require("hardhat");
const readline = require("readline");

import {
  FinderEthers,
  GovernorEthers,
  ProposerEthers,
  VotingEthers,
  VotingTokenEthers,
  EmergencyProposerEthers__factory,
} from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";
import {
  EMERGENCY_EXECUTOR,
  formatIndentation,
  getMultiRoleContracts,
  getOwnableContracts,
  NEW_CONTRACTS,
  VOTING_UPGRADER_ADDRESS,
} from "./migrationUtils";

const { getContractFactory } = hre.ethers;

async function main() {
  console.log("Running VotingV2 Deployments🔥");

  const networkId = Number(await hre.getChainId());

  const finder = await getContractInstance<FinderEthers>("Finder");
  const governor = await getContractInstance<GovernorEthers>("Governor");
  const proposer = await getContractInstance<ProposerEthers>("Proposer");
  const existingVoting = await getContractInstance<VotingEthers>("Voting");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  // In localhost network we allow to not set the emergency executor address and default to the first account.
  if (!process.env[EMERGENCY_EXECUTOR] && hre.network.name != "localhost") throw new Error("No emergency executor set");

  // Start DVM2.0 parameters
  const emergencyQuorum = hre.ethers.utils.parseUnits("5000000", "ether");
  const emergencyExecutor =
    hre.network.name === "localhost"
      ? (await hre.ethers.getSigners())[0].address
      : "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D"; // Dev wallet

  const emergencyMinimumWaitTime = 60 * 60 * 24 * 10; // 10 days

  // baseSlashAmount: amount slashed for missing a vote or voting wrong.
  const baseSlashAmount = hre.ethers.utils.parseUnits("0.001", "ether");

  // governanceSlashAmount: amount slashed for voting wrong in a governance vote.
  const governanceSlashAmount = hre.ethers.utils.parseUnits("0", "ether");

  const emissionRate = "0"; // Initially set the emission rate to 0.
  const unstakeCooldown = 60 * 60 * 24 * 7; // 7 days
  const phaseLength = "86400"; // 1 day
  const gat = hre.ethers.utils.parseUnits("5000000", "ether"); // Set the GAT to 5.0 million tokens.

  // Set the SPAT to 50%. This is the percentage of staked tokens that must participate to resolve a vote.
  const spat = hre.ethers.utils.parseUnits("0.5", "ether");

  // A price request can roll, at maximum, 4 times before it is auto deleted (i.e on the 3rd roll it is auto deleted).
  const maxRolls = 4;

  // The maximum number of requests that can be placed within a single round. If exceeded, the request will auto roll.
  const maxRequestsPerRound = 1000;

  // ProposerV2 default bond
  const proposerV2DefaultBond = hre.ethers.utils.parseUnits("5000", "ether");

  // DVM upgrader address
  const votingUpgraderAddress =
    hre.network.name === "localhost"
      ? (await hre.ethers.getSigners())[0].address
      : "0x9A8f92a830A5cB89a3816e3D267CB7791c16b04D"; // Dev wallet

  console.log("DVM2.0 Parameters:");
  console.table({
    emergencyQuorum: hre.ethers.utils.formatUnits(emergencyQuorum, "ether"),
    emergencyExecutor,
    emergencyMinimumWaitTime,
    baseSlashAmount: hre.ethers.utils.formatUnits(baseSlashAmount, "ether"),
    governanceSlashAmount: hre.ethers.utils.formatUnits(governanceSlashAmount, "ether"),
    emissionRate: hre.ethers.utils.formatUnits(emissionRate, "ether"),
    unstakeCooldown,
    phaseLength,
    gat: hre.ethers.utils.formatUnits(gat, "ether"),
    spat: hre.ethers.utils.formatUnits(spat, "ether"),
    maxRolls,
    maxRequestsPerRound,
    proposerV2DefaultBond: hre.ethers.utils.formatUnits(proposerV2DefaultBond, "ether"),
    votingUpgraderAddress,
  });

  // End DVM2.0 parameters

  const readlineInterface = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const deployNewContracts = await new Promise((resolve) => {
    readlineInterface.question(
      formatIndentation(`Do you want to deploy the new contracts? (y/n) (default: y)`),
      (answer: string) => {
        readlineInterface.close();
        resolve(answer === "y" || answer === "Y" || answer === "");
      }
    );
  });

  if (!deployNewContracts) {
    console.log("Skipping new contracts deployment");
    return;
  }

  console.log("1. DEPLOYING SLASHING LIBRARY");
  const slashingLibraryFactory = await getContractFactory("FixedSlashSlashingLibrary");
  const slashingLibrary = await slashingLibraryFactory.deploy(baseSlashAmount, governanceSlashAmount);

  console.log("Deployed SlashingLibrary: ", slashingLibrary.address);

  console.log("2. DEPLOYING VOTING V2");
  const votingV2Factory = await getContractFactory("VotingV2");

  const votingV2 = await votingV2Factory.deploy(
    emissionRate,
    unstakeCooldown,
    phaseLength,
    maxRolls,
    maxRequestsPerRound,
    gat,
    spat,
    votingToken.address,
    finder.address,
    slashingLibrary.address,
    existingVoting.address
  );

  console.log("Deployed VotingV2: ", votingV2.address);

  console.log("3. DEPLOYING GOVERNOR V2");

  const governorV2Factory = await getContractFactory("GovernorV2");

  const governorStartingId = (await governor.numProposals()).add(1).toNumber(); // Existing proposals plus the new one.

  console.log("Starting id for new Governor contract: ", governorStartingId);

  const governorV2 = await governorV2Factory.deploy(finder.address, governorStartingId);

  console.log("Deployed GovernorV2: ", governorV2.address);

  console.log("4. DEPLOYING VOTING UPGRADER");

  const ownableContractsToMigrate = await getOwnableContracts(networkId);

  const multicallContractsToMigrate = await getMultiRoleContracts(networkId);

  const votingUpgraderFactoryV2 = await getContractFactory("VotingUpgraderV2");
  const votingUpgrader = await votingUpgraderFactoryV2.deploy(
    votingUpgraderAddress,
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
  const proposerFactory = await getContractFactory("ProposerV2");
  const proposerV2 = await proposerFactory.deploy(
    votingToken.address,
    proposerV2DefaultBond,
    governorV2.address,
    finder.address
  );
  console.log("Deployed ProposerV2: ", proposerV2.address);

  console.log("6. Deploying EmergencyProposer");

  const emergencyProposerFactory: EmergencyProposerEthers__factory = await getContractFactory("EmergencyProposer");

  const emergencyProposer = await emergencyProposerFactory.deploy(
    votingToken.address,
    emergencyQuorum,
    governorV2.address,
    emergencyExecutor,
    emergencyMinimumWaitTime
  );

  console.log("Deployed EmergencyProposer: ", emergencyProposer.address);

  console.log("7. Set ProposerV2 as the proposer of GovernorV2");
  let tx = await governorV2.resetMember(1, proposerV2.address);
  await tx.wait();

  console.log("8. Set the EmergencyProposer as the emergency proposer of the new governor");
  tx = await governorV2.resetMember(2, emergencyProposer.address);
  await tx.wait();

  console.log("9. Set the old governor as the owner of the new governor");
  // The new governor owner will be updated in the VotingUpgraderV2 contract.
  tx = await governorV2.resetMember(0, governor.address);
  await tx.wait();

  console.log("10. Set the new governor as the owner of the new voting v2");
  tx = await votingV2.transferOwnership(governorV2.address);
  await tx.wait();

  console.log("Deployment done!🎉");

  console.log("Next step, Propose migration: ");
  console.log(
    formatIndentation(
      `
  ☝️ PROPOSAL: Run the following command to propose the migration to VotingV2, GovernorV2 and ProposerV2:
  ${VOTING_UPGRADER_ADDRESS}=${votingUpgrader.address} \\
  ${NEW_CONTRACTS.voting}=${votingV2.address} \\
  ${NEW_CONTRACTS.governor}=${governorV2.address} \\
  ${NEW_CONTRACTS.proposer}=${proposerV2.address} \\
  ${NEW_CONTRACTS.emergencyProposer}=${emergencyProposer.address} \\
  ${EMERGENCY_EXECUTOR}=${emergencyExecutor} \\
  yarn hardhat run ./src/upgrade-tests/voting2/1_Propose.ts --network ${hre.network.name}`
    )
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
