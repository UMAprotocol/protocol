// This script mitigates request roll timing attack vector on the VotingV2 contract. In particular, it verifies that no
// requests can be rolled into the current round if we have reached the configured time threshold from the start of the
// round. Otherwise it throws an error.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
//   CUSTOM_NODE_URL=https://<goerli OR mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
//   ROLL_TIME_THRESHOLD=<TIME FROM ROUND START IN SECONDS> \
//   yarn hardhat run ./src/monitoring-dvm2.0/rollTiming.ts

import { strict as assert } from "assert";
import { getVotingContracts } from "../utils/votingv2-utils";

async function main() {
  const { votingV2 } = await getVotingContracts();

  // Check we are in the commit phase.
  if ((await votingV2.getVotePhase()) !== 0) {
    console.log("Not in the commit phase, skipping request processing timing check.");
    return;
  }

  // Check if we have reached the configured time threshold from the start of the round.
  const phaseLength = await votingV2.voteTiming();
  const rollTimeThreshold =
    process.env.ROLL_TIME_THRESHOLD !== undefined ? Number(process.env.ROLL_TIME_THRESHOLD) : 60 * 60;
  assert(rollTimeThreshold < phaseLength.toNumber(), "Roll time threshold must be less than the phase length");
  const currentPhaseStartTime = await votingV2.getRoundEndTime((await votingV2.getCurrentRoundId()) - 1);
  if ((await votingV2.getCurrentTime()).sub(currentPhaseStartTime).toNumber() < rollTimeThreshold) {
    console.log("Not enough time has passed since the start of the round, skipping request processing timing check.");
    return;
  }

  // Call processResolvablePriceRequests() to see if any of requests would get rolled.
  const tx = await votingV2.processResolvablePriceRequests();
  const result = await tx.wait();
  const requestRolledEvents = await votingV2.queryFilter(
    votingV2.filters.RequestRolled(),
    result.blockNumber,
    result.blockNumber
  );
  if (requestRolledEvents.length > 0) throw new Error("Requests can be rolled in the current round!");

  console.log("Request processing timing check passed! No requests can be rolled in the current round.");
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
