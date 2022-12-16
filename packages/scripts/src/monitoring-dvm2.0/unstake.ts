// This script verifies the correct functioning of the VotingV2 contract. In particular, it verifies that, once all the
// voters are processed by the updateTrackers function, all voters can make a full unstake of their tokens. If this is
// not possible, the script will fail with an error.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
// CUSTOM_NODE_URL=https://<goerli OR mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
// yarn hardhat run ./src/monitoring-dvm2.0/unstake.ts

import { VotingV2Ethers } from "@uma/contracts-node";
import { getContractInstance } from "../utils/contracts";
import { forkNetwork, getForkChainId } from "../utils/utils";
import { getUniqueVoters, unstakeFromStakedAccount, updateTrackers } from "./common";

async function main() {
  if (!process.env.CUSTOM_NODE_URL) throw new Error("CUSTOM_NODE_URL must be defined in env");
  await forkNetwork(process.env.CUSTOM_NODE_URL);
  const chainId = await getForkChainId(process.env.CUSTOM_NODE_URL);

  if (!chainId || (chainId != 1 && chainId != 5)) throw new Error("This script should be run on mainnet or goerli");

  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2", undefined, chainId);

  const uniqueVoters = await getUniqueVoters(votingV2);

  // Update trackers for all voters
  await updateTrackers(votingV2, uniqueVoters);

  console.log("Unstaking from all voters");
  // If the script fails here, it means that some voters are not able to unstake their tokens.
  for (const voter of uniqueVoters) {
    await unstakeFromStakedAccount(votingV2, voter);
  }
  console.log("Unstake health check passed! All voters have been unstaked successfully.");
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
