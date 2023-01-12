// This script deploys SlashingLibrary, VotingV2, GovernorV2, ProposerV2, EmergencyProposer and VotingUpgrader.
// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// EMERGENCY_EXECUTOR=<EMERGENCY-EXECUTOR-ADDRESS> \
// EMERGENCY_QUORUM=<EMERGENCY-QUORUM> \ # Decimal value between 5M and 10M
// yarn hardhat run ./src/upgrade-tests/voting2/0_Deploy.ts --network localhost

const hre = require("hardhat");

import {
  EmergencyProposerEthers__factory,
  FinderEthers,
  GovernorEthers,
  GovernorV2Ethers__factory,
  ProposerEthers,
  ProposerV2Ethers__factory,
  FixedSlashSlashingLibraryEthers__factory,
  VotingEthers,
  VotingTokenEthers,
  VotingUpgraderV2Ethers__factory,
  VotingV2Ethers__factory,
} from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";
import {
  EMERGENCY_EXECUTOR,
  EMERGENCY_QUORUM,
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

  if (!process.env[EMERGENCY_QUORUM]) throw new Error("No emergency quorum set");
  const tenMillion = hre.ethers.utils.parseUnits("10000000", "ether");
  const fiveMillion = hre.ethers.utils.parseUnits("5000000", "ether");
  const emergencyQuorum = hre.ethers.utils.parseUnits(process.env[EMERGENCY_QUORUM], "ether");
  if (emergencyQuorum.gt(tenMillion) || emergencyQuorum.lt(fiveMillion)) throw new Error("Invalid emergency quorum");

  console.log("1. DEPLOYING SLASHING LIBRARY");
  const slashingLibraryFactory: FixedSlashSlashingLibraryEthers__factory = await getContractFactory("SlashingLibrary");
  const slashingLibrary = await slashingLibraryFactory.deploy();

  console.log("Deployed SlashingLibrary: ", slashingLibrary.address);

  console.log("2. DEPLOYING VOTING V2");
  const votingV2Factory: VotingV2Ethers__factory = await getContractFactory("VotingV2");
  const emissionRate = "0"; // Initially set the emission rate to 0.
  const unstakeCooldown = 60 * 60 * 24 * 7; // 7 days
  const phaseLength = "86400";
  const gat = hre.ethers.utils.parseUnits("5500000", "ether"); // Set the GAT to 5.5 million tokens.

  // Set the SPAT to 25%. This is the percentage of staked tokens that must participate to resolve a vote.
  const spat = hre.ethers.utils.parseUnits("0.25", "ether");

  // A price request can roll, at maximum, 2 times before it is auto deleted (i.e on the 3rd roll it is auto deleted).
  const maxRolls = 2;

  const votingV2 = await votingV2Factory.deploy(
    emissionRate,
    unstakeCooldown,
    phaseLength,
    maxRolls,
    gat,
    spat,
    votingToken.address,
    finder.address,
    slashingLibrary.address,
    existingVoting.address
  );

  console.log("Deployed VotingV2: ", votingV2.address);

  console.log("3. DEPLOYING GOVERNOR V2");

  const governorV2Factory: GovernorV2Ethers__factory = await getContractFactory("GovernorV2");

  const governorStartingId = (await (await governor.numProposals()).add(1)).toNumber(); // Existing proposals plus the new one.

  console.log("Starting id for new Governor contract: ", governorStartingId);

  const governorV2 = await governorV2Factory.deploy(finder.address, governorStartingId);

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

  console.log("6. Deploying EmergencyProposer");
  const emergencyExecutor = process.env[EMERGENCY_EXECUTOR] || (await hre.ethers.getSigners())[0].address;
  const emergencyProposerFactory: EmergencyProposerEthers__factory = await getContractFactory("EmergencyProposer");
  const emergencyProposer = await emergencyProposerFactory.deploy(
    votingToken.address,
    emergencyQuorum,
    governorV2.address,
    emergencyExecutor
  );
  console.log("Deployed EmergencyProposer: ", emergencyProposer.address);

  console.log("7. Set ProposerV2 as the proposer of GovernorV2");
  await governorV2.resetMember(1, proposerV2.address);

  console.log("8. Set the EmergencyProposer as the emergency proposer of the new governor");
  await governorV2.resetMember(2, emergencyProposer.address);

  console.log("9. Set the old governor as the owner of the new governor");
  // The new governor owner will be updated in the VotingUpgraderV2 contract.
  await governorV2.resetMember(0, governor.address);

  console.log("10. Set the new governor as the owner of the new voting v2");
  await votingV2.transferOwnership(governorV2.address);

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
