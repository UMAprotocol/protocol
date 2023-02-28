// This script verifies the correct functioning of the VotingV2 contract. In particular, it verifies that, once all the
// voters are processed by the updateTrackers function, the sum of the slashedTokens of all the VoterSlashed emitted
// events is equal to zero. Otherwise it throws an error.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
// CUSTOM_NODE_URL=https://<goerli OR mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
// yarn hardhat run ./src/monitoring-dvm2.0/slashingEvents.ts

import { BigNumber } from "ethers";
import { bigNumberAbsDiff } from "../utils/utils";
import {
  getNumberSlashedEvents,
  getSumSlashedEvents,
  getUniqueVoters,
  getVotingContracts,
  updateTrackers,
} from "../utils/votingv2-utils";

async function main() {
  const { votingV2 } = await getVotingContracts();

  const uniqueVoters = await getUniqueVoters(votingV2);

  // Update trackers for all voters
  await updateTrackers(votingV2, uniqueVoters);

  const sumSlashEvents = await getSumSlashedEvents(votingV2);
  const numberSlashedEvents = await getNumberSlashedEvents(votingV2);

  // The sum of SlashEvents should be smaller than the number of slashes, as
  // each slash can result in 1 WEI of imprecision due to rounding.
  const absDiff = bigNumberAbsDiff(sumSlashEvents, BigNumber.from(0));

  if (!absDiff.lte(numberSlashedEvents)) {
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
