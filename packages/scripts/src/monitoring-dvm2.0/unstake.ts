// This script verifies the correct functioning of the VotingV2 contract. In particular, it verifies that, once all the
// voters are processed by the updateTrackers function, all voters can make a full unstake of their tokens. If this is
// not possible, the script will fail with an error.
// It can be run on a mainnet or goerli fork, with the following command and environment variables:
// CUSTOM_NODE_URL=https://<goerli OR mainnet>.infura.io/v3/<YOUR-INFURA-KEY> \
// yarn hardhat run ./src/monitoring-dvm2.0/unstake.ts

import { BigNumber } from "ethers";
import { bigNumberAbsDiff } from "../utils/utils";
import {
  getNumberSlashedEvents,
  getUniqueVoters,
  getVotingContracts,
  unstakeFromStakedAccount,
  updateTrackers,
  votingV2VotingBalanceWithoutExternalTransfers,
} from "../utils/votingv2-utils";

async function main() {
  const { votingV2, votingToken } = await getVotingContracts();

  const uniqueVoters = await getUniqueVoters(votingV2);

  // Update trackers for all voters
  await updateTrackers(votingV2, uniqueVoters);

  console.log("Unstaking from all voters");

  // We must process these in series since these functions have concurrency issues due to changing the block time.
  for (const voter of uniqueVoters) {
    await unstakeFromStakedAccount(votingV2, voter);
  }

  const numberSlashedEvents = await getNumberSlashedEvents(votingV2);
  const votingV2BalanceWithoutExternalTransfers = await votingV2VotingBalanceWithoutExternalTransfers(
    votingToken,
    votingV2
  );

  // Balance in voting token of voting v2 should be 0 with a tolerance of numberSlashedEvents, as every slash can result
  // in 1 WEI of imprecision due to rounding.
  const absDiff = bigNumberAbsDiff(BigNumber.from(0), votingV2BalanceWithoutExternalTransfers);
  if (!absDiff.lte(numberSlashedEvents))
    throw new Error(
      `VotingV2 balance should be between 0 and ${numberSlashedEvents} but is ${votingV2BalanceWithoutExternalTransfers}`
    );

  // VotingV2 cumulativeStake should be 0 with a tolerance of numberSlashedEvents, as every slash can result in 1 WEI of
  // imprecision due to rounding.
  const cumulativeStake = await votingV2.cumulativeStake();
  if (cumulativeStake.gt(numberSlashedEvents))
    throw new Error(
      `VotingV2 cumulativeStake should be between 0 and ${numberSlashedEvents} but is ${cumulativeStake}`
    );

  console.log("Unstake health check passed! All voters have been unstaked successfully");
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
