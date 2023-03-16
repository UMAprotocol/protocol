// This script verifies the correct functioning of the VotingV2 contract. In particular, it verifies that, once all the
// voters are processed by the updateTrackers function, the balance of the VotingV2 contract in VotingTokens is equal to
// the sum of all users' stakes and pendingUnstakes. Otherwise it throws an error.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
// Or a goerli fork with:
// CUSTOM_NODE_URL=https://<goerli OR mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
// yarn hardhat run ./src/monitoring-dvm2.0/voterStakes.ts

const hre = require("hardhat");
import { bigNumberAbsDiff } from "../utils/utils";
import {
  getNumberSlashedEvents,
  getUniqueVoters,
  getVotingContracts,
  updateTrackers,
  votingV2VotingBalanceWithoutExternalTransfers,
} from "../utils/votingv2-utils";
const { ethers } = hre;

async function main() {
  const { votingV2, votingToken } = await getVotingContracts();

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

  const numberSlashedEvents = await getNumberSlashedEvents(votingV2);
  const votingV2BalanceWithoutExternalTransfers = await votingV2VotingBalanceWithoutExternalTransfers(
    votingToken,
    votingV2
  );
  // The difference between the total stakes and the votingV2 balance should be smaller than the number of slashes, as
  // each slash can result in 1 WEI of imprecision due to rounding.
  const absDiff = bigNumberAbsDiff(sumStakes, votingV2BalanceWithoutExternalTransfers);
  if (!absDiff.lte(numberSlashedEvents)) {
    throw new Error(
      `The difference between sumStakes(${sumStakes}) and votingV2BalanceWithoutExternalTransfers(${votingV2BalanceWithoutExternalTransfers}) should be less than ${numberSlashedEvents} but it is ${absDiff}.`
    );
  }
  console.log("Voter staked health check passed! The sum of all the stakes is equal to the votingV2 balance");
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
