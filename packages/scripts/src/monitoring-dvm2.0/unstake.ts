// This script verifies the correct functioning of the VotingV2 contract. In particular, it verifies that, once all the
// voters are processed by the updateTrackers function, all voters can make a full unstake of their tokens. If this is
// not possible, the script will fail with an error.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
// FORK_URL=https://<goerli | mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
// HARDHAT_CHAIN_ID=<1 | 5> \
// yarn hardhat run ./src/monitoring-dvm2.0/unstake.ts

import { forkNetwork } from "../utils/utils";
import { getUniqueVoters, getVotingV2, unstakeFromStakedAccount, updateTrackers } from "./common";

async function main() {
  if (!process.env.FORK_URL) throw new Error("FORK_URL must be defined in env");
  await forkNetwork(process.env.FORK_URL);
  const networkId = process.env.HARDHAT_CHAIN_ID;
  if (!networkId || (networkId != "1" && networkId != "5"))
    throw new Error("This script should be run on mainnet or goerli");

  const votingV2 = await getVotingV2();

  console.log("VotingV2 address: ", votingV2.address);

  const uniqueVoters = await getUniqueVoters(votingV2);

  // Update trackers for all voters
  await updateTrackers(votingV2, uniqueVoters);

  for (const voter of uniqueVoters) {
    await unstakeFromStakedAccount(votingV2, voter);
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
