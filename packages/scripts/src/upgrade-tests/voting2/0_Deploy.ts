// This script deploys SlashingLibrary, VotingV2 and VotingUpgrader.
// This script can be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// yarn hardhat run ./src/upgrade-tests/voting2/0_Deploy.ts --network localhost

const hre = require("hardhat");

import { VotingUpgrader__factory } from "@uma/contracts-frontend/dist/typechain/core/ethers";
import {
  Finder,
  Governor,
  SlashingLibrary__factory,
  Voting,
  VotingToken,
  VotingV2__factory,
} from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../../utils/contracts";

const { getContractFactory } = hre.ethers;

async function main() {
  console.log("Running VotingV2 Deployments🔥");

  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const existingVoting = await getContractInstance<Voting>("Voting");
  const votingToken = await getContractInstance<VotingToken>("VotingToken");

  console.log("1. DEPLOYING SLASHING LIBRARY");
  const slashingLibraryFactory: SlashingLibrary__factory = await getContractFactory("SlashingLibrary");
  const slashingLibrary = await slashingLibraryFactory.deploy();

  console.log("Deployed SlashingLibrary: ", slashingLibrary.address);

  console.log("2. DEPLOYING VOTING V2");
  const votingV2Factory: VotingV2__factory = await getContractFactory("VotingV2");
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
    "0", // Starting request index of 0 (no offset).
    votingToken.address,
    finder.address,
    slashingLibrary.address
  );

  console.log("Deployed VotingV2: ", votingV2.address);

  console.log("3. DEPLOYING VOTING UPGRADER");
  const votingUpgraderFactory: VotingUpgrader__factory = await getContractFactory("VotingUpgrader");
  const votingUpgrader = await votingUpgraderFactory.deploy(
    governor.address,
    existingVoting.address,
    votingV2.address,
    finder.address,
    votingV2.address // TODO decide which address to use
  );

  console.log("Deployed VotingUpgrader: ", votingUpgrader.address);

  console.log("Deployment done!🎉");
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
