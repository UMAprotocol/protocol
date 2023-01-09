// This script verifies the correct functioning of the VotingV2 contract. In particular, it verifies that, once all the
// voters are processed by the updateTrackers function, the sum of the slashedTokens of all the VoterSlashed emitted
// events is equal to zero. Otherwise it throws an error.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
// CUSTOM_NODE_URL=https://<goerli OR mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
// yarn hardhat run ./src/monitoring-dvm2.0/slashingEvents.ts

import { getSumSlashedEvents, getUniqueVoters, getVotingContracts, updateTrackers } from "./common";

async function main() {
  const { votingV2 } = await getVotingContracts();

  const uniqueVoters = await getUniqueVoters(votingV2);

  // Update trackers for all voters
  await updateTrackers(votingV2, uniqueVoters);

  const sumSlashEvents = await getSumSlashedEvents(votingV2);

  if (!sumSlashEvents.eq(0)) {
    throw new Error(
      "The sum of slashedTokens across all VoterSlashed events is not zero. Instead it is: " + sumSlashEvents.toString()
    );
  }
  console.log("Slashing health check passed! The sum of slashedTokens across all VoterSlashed events is zero");
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
