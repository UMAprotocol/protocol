// This script verifies the correct functioning of the VotingV2 contract. In particular, it verifies that, once all the
// voters are processed by the updateTrackers function, the sum of the slashedTokens of all the VoterSlashed emitted
// events is equal to zero. Otherwise it throws an error.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
// CUSTOM_NODE_URL=https://<goerli OR mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
// yarn hardhat run ./src/monitoring-dvm2.0/slashingEvents.ts

import { VotingV2Ethers } from "@uma/contracts-node";
import { getContractInstance } from "../utils/contracts";
import { forkNetwork, getForkChainId } from "../utils/utils";
import { getSumSlashedEvents, getUniqueVoters, updateTrackers } from "./common";

async function main() {
  if (!process.env.CUSTOM_NODE_URL) throw new Error("CUSTOM_NODE_URL must be defined in env");
  await forkNetwork(process.env.CUSTOM_NODE_URL);
  const chainId = await getForkChainId(process.env.CUSTOM_NODE_URL);

  if (!chainId || (chainId != 1 && chainId != 5)) throw new Error("This script should be run on mainnet or goerli");

  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2", undefined, chainId);

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
