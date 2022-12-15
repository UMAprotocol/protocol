// This script verifies the correct functioning of the VotingV2 contract. In particular, it verifies that, once all the
// voters are processed by the updateTrackers function, the balance of the VotingV2 contract in VotingTokens is equal to
// the sum of all users' stakes and pendingUnstakes. Otherwise it throws an error.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
// Or a goerli fork with:
// FORK_URL=https://<goerli | mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
// HARDHAT_CHAIN_ID=<1 | 5> \
// yarn hardhat run ./src/monitoring-dvm2.0/voterStakes.ts

const hre = require("hardhat");
import { VotingTokenEthers } from "@uma/contracts-node";
import { getContractInstance } from "../utils/contracts";
import { forkNetwork } from "../utils/utils";
import { getUniqueVoters, getVotingV2, updateTrackers } from "./common";
const { ethers } = hre;

async function main() {
  if (!process.env.FORK_URL) throw new Error("FORK_URL must be defined in env");
  await forkNetwork(process.env.FORK_URL);
  const networkId = process.env.HARDHAT_CHAIN_ID;
  if (!networkId || (networkId != "1" && networkId != "5"))
    throw new Error("This script should be run on mainnet or goerli");

  const votingV2 = await getVotingV2();
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const uniqueVoters = await getUniqueVoters(votingV2);

  // Update trackers for all voters
  await updateTrackers(votingV2, uniqueVoters);

  // get voter stakes for each voter
  const voterStakes = await Promise.all(
    uniqueVoters.map(async (voter) => {
      const stake = await votingV2.voterStakes(voter);
      return stake.stake.add(stake.pendingUnstake);
    })
  );

  const sumStakes = voterStakes.reduce((a, b) => a.add(b), ethers.BigNumber.from(0));

  const votingV2Balance = await votingToken.balanceOf(votingV2.address);

  if (!sumStakes.eq(votingV2Balance)) {
    throw new Error("The sum of all the stakes should be equal to the votingV2 balance");
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
