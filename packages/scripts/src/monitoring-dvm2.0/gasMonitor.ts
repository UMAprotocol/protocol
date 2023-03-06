// This Script verifies that potentially high gas cost actions are bounded in their max gas cost. In particular, check
// how much gas it would cost to run processResolvablePriceRequests and updateTrackers for each voter. If the gas cost
// is exorbitant, then the script will throw an error. and this should be dealt with by the UMA team.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
// CUSTOM_NODE_URL=https://<goerli OR mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
// yarn hardhat run ./src/monitoring-dvm2.0/gasMonitor.ts

import { getUniqueVoters, getVotingContracts } from "../utils/votingv2-utils";

async function main() {
  const { votingV2 } = await getVotingContracts();

  // Step1. Verify the gas cost of processResolvablePriceRequests
  const tx = await votingV2.processResolvablePriceRequests();
  const result = await tx.wait();
  if (result.gasUsed.gt(process.env.MAX_RESOLUTION_GAS || 1000000))
    throw new Error(`Gas used for processResolvablePriceRequests is very high at ${result.gasUsed.toString()}!`);

  // Step2. Verify the cost of updating gas trackers for voters, one at a time, post price resolution.
  const uniqueVoters = await getUniqueVoters(votingV2);
  for (const voter of uniqueVoters) {
    const tx = await votingV2.updateTrackers(voter);
    const result = await tx.wait();
    if (result.gasUsed.gt(process.env.MAX_TRACKER_UPDATE_GAS || 1000000))
      throw new Error(`Gas used for updateTrackers is very high at ${result.gasUsed.toString()}!`);
  }

  console.log("Gas usage checks passed! All gas usage is within bounds");
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
