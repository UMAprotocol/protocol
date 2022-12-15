// This script monitors that the sum of all the slashes in the VotingV2 is 0.
// This script should be run against a mainnet fork by spinning a node in a separate terminal with:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Or a goerli fork with:
// HARDHAT_CHAIN_ID=5 yarn hardhat node --fork https://goerli.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// and then running this script with:
// yarn hardhat run ./src/monitoring/MonitorVotingV2Events.ts  --network localhost

const hre = require("hardhat");

import { VotingV2Ethers } from "@uma/contracts-node";
import { getContractInstance } from "../utils/contracts";

import { increaseEvmTime } from "../utils/utils";

async function main() {
  const networkId = Number(await hre.getChainId());
  if (networkId != 1 && networkId != 5) throw new Error("This script should be run on mainnet or goerli");

  const votingV2AddressMainnet = "";
  const votingV2AddressGoerli = "0xF71cdF8A34c56933A8871354A2570a301364e95F";

  const votingV2 = await getContractInstance<VotingV2Ethers>(
    "VotingV2",
    networkId == 1 ? votingV2AddressMainnet : votingV2AddressGoerli
  );

  const getSumSlashedEvents = async () => {
    const voterSlashedEvents = await votingV2.queryFilter(votingV2.filters.VoterSlashed(), 0, "latest");

    return voterSlashedEvents
      .map((voterSlashedEvent) => voterSlashedEvent.args.slashedTokens)
      .reduce((a, b) => a.add(b), hre.ethers.BigNumber.from(0));
  };

  const getSlashedVotersAddresses = async () => {
    const uniqueSlashedVoters: string[] = [];
    const voterSlashedEvents = await votingV2.queryFilter(votingV2.filters.VoterSlashed(), 0, "latest");

    for (const event of voterSlashedEvents)
      if (!uniqueSlashedVoters.includes(event.args.voter)) uniqueSlashedVoters.push(event.args.voter);
    return uniqueSlashedVoters;
  };

  const unstakeFromStakedAccount = async (voters: string[]) => {
    for (const voter of voters) {
      const stakeBalance = await votingV2.callStatic.getVoterStakePostUpdate(voter);
      const tx = await votingV2.requestUnstake(stakeBalance);
      await tx.wait();
    }

    await increaseEvmTime(60);

    console.log("UU");
  };

  console.log("VotingV2 address: ", votingV2.address);

  const stakedEvents = await votingV2.queryFilter(votingV2.filters.Staked(null, null, null), 0, "latest");
  const delegateSetEvents = await votingV2.queryFilter(votingV2.filters.DelegateSet(null, null), 0, "latest");
  console.log("delegateSetEvents", delegateSetEvents);

  const uniqueVoters: string[] = [];
  for (const event of stakedEvents) if (!uniqueVoters.includes(event.args.voter)) uniqueVoters.push(event.args.voter);
  for (const event of delegateSetEvents)
    if (!uniqueVoters.includes(event.args.delegator)) uniqueVoters.push(event.args.delegator);
  for (const event of delegateSetEvents)
    if (!uniqueVoters.includes(event.args.delegate)) uniqueVoters.push(event.args.delegate);

  console.log("Unique voters: ", uniqueVoters.length);
  console.log("Voters: ", uniqueVoters);

  const sumSlashEventsBefore = await getSumSlashedEvents();

  console.log("Initial sum of slashedTokens between all stakeholder: ", sumSlashEventsBefore.toString());

  // Update trackers for all voters
  console.log("Updating trackers for all voters");
  const tx = await votingV2.multicall(
    uniqueVoters.map((voter) => votingV2.interface.encodeFunctionData("updateTrackers", [voter])),
    { maxFeePerGas: 1000000000 }
  );
  await tx.wait();
  console.log("Done updating trackers for all voters");

  const sumSlashEvents = await getSumSlashedEvents();

  console.log("Sum of slashedTokens between all stakeholder after update trackers: ", sumSlashEvents.toString());

  console.log("getSlashedVotersAddresses", await getSlashedVotersAddresses());

  await unstakeFromStakedAccount(uniqueVoters);

  if (!sumSlashEvents.eq(0)) {
    throw new Error("The sum of slashedTokens between all stakeholder should be 0");
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
