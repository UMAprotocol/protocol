import { VotingV2Ethers } from "@uma/contracts-node";
import { BigNumber } from "ethers";
import { increaseEvmTime } from "../utils/utils";

const hre = require("hardhat");
const { ethers } = hre;

export const getUniqueVoters = async (votingV2: VotingV2Ethers): Promise<string[]> => {
  const stakedEvents = await votingV2.queryFilter(votingV2.filters.Staked(null, null, null));

  const uniqueVoters: string[] = [];
  for (const event of stakedEvents) {
    if (!uniqueVoters.includes(event.args.voter)) uniqueVoters.push(event.args.voter);
  }
  return uniqueVoters;
};

export const updateTrackers = async (votingV2: VotingV2Ethers, voters: string[]): Promise<void> => {
  console.log("Updating trackers for all voters");
  const tx = await votingV2.multicall(
    voters.map((voter) => votingV2.interface.encodeFunctionData("updateTrackers", [voter]))
  );
  await tx.wait();
  console.log("Done updating trackers for all voters");
};

export const getSumSlashedEvents = async (votingV2: VotingV2Ethers): Promise<BigNumber> => {
  const voterSlashedEvents = await votingV2.queryFilter(votingV2.filters.VoterSlashed(), 0, "latest");
  return voterSlashedEvents
    .map((voterSlashedEvent) => voterSlashedEvent.args.slashedTokens)
    .reduce((a, b) => a.add(b), ethers.BigNumber.from(0));
};

export const unstakeFromStakedAccount = async (votingV2: VotingV2Ethers, voter: string): Promise<void> => {
  let stakeBalance = await votingV2.callStatic.getVoterStakePostUpdate(voter);

  if (stakeBalance.gt(ethers.BigNumber.from(0))) {
    console.log("Unstaking from", voter, stakeBalance.toString());
    const impersonatedSigner = await ethers.getImpersonatedSigner(voter);
    if ((await votingV2.voterStakes(voter)).pendingUnstake.gt(ethers.BigNumber.from(0))) {
      console.log("Staker", voter, "has a pending unstake. Executing then re-unstaking");
      const tx = await votingV2.connect(impersonatedSigner).executeUnstake();
      await tx.wait();
    }

    stakeBalance = await votingV2.callStatic.getVoterStakePostUpdate(voter);
    const tx = await votingV2.connect(impersonatedSigner).requestUnstake(stakeBalance);
    await tx.wait();
  }

  await increaseEvmTime(await (await votingV2.unstakeCoolDown()).toNumber());

  const pendingUnstake = (await votingV2.voterStakes(voter)).pendingUnstake;
  if (pendingUnstake.gt(ethers.BigNumber.from(0))) {
    console.log("Executing unstake from", voter, pendingUnstake.toString());
    const impersonatedSigner = await ethers.getImpersonatedSigner(voter);
    const tx = await votingV2.connect(impersonatedSigner).executeUnstake();
    await tx.wait();
  }
};
