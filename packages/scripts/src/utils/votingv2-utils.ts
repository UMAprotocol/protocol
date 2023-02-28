import { VotingTokenEthers, VotingV2Ethers } from "@uma/contracts-node";
import { TypedEventFilter } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/commons";
import { BigNumber } from "ethers";
import { getContractInstance } from "./contracts";
import { forkNetwork, getForkChainId, increaseEvmTime } from "./utils";

const hre = require("hardhat");
const { ethers } = hre;

export const getVotingContracts = async (): Promise<{ votingV2: VotingV2Ethers; votingToken: VotingTokenEthers }> => {
  if (!process.env.CUSTOM_NODE_URL) throw new Error("CUSTOM_NODE_URL must be defined in env");
  await forkNetwork(process.env.CUSTOM_NODE_URL);
  const chainId = await getForkChainId(process.env.CUSTOM_NODE_URL);

  if (!chainId || (chainId != 1 && chainId != 5)) throw new Error("This script should be run on mainnet or goerli");

  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2", undefined, chainId);
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken", undefined, chainId);
  return { votingV2, votingToken };
};

export const getUniqueVoters = async (votingV2: VotingV2Ethers): Promise<string[]> => {
  const stakedEvents = await votingV2.queryFilter(votingV2.filters.Staked(null, null, null));
  const uniqueVoters = new Set<string>(stakedEvents.map((event) => event.args.voter));
  return Array.from(uniqueVoters);
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

export const getNumberSlashedEvents = async (votingV2: VotingV2Ethers): Promise<number> => {
  const voterSlashedEvents = await votingV2.queryFilter(votingV2.filters.VoterSlashed(), 0, "latest");
  return voterSlashedEvents.length;
};

export const getVotingTokenExternalTransfersAmount = async (
  votingToken: VotingTokenEthers,
  votingV2: VotingV2Ethers
): Promise<BigNumber> => {
  const transferEvents = await votingToken.queryFilter(
    votingToken.filters.Transfer(null, votingV2.address, null),
    0,
    "latest"
  );

  let sumExternalTransfers = BigNumber.from(0);

  for (let i = 0; i < transferEvents.length; i++) {
    const transferEvent = transferEvents[i];
    const allVotingV2Events = await votingV2.queryFilter(
      "*" as TypedEventFilter<void, void>,
      transferEvent.blockNumber,
      transferEvent.blockNumber
    );
    // Check that there is a VotingV2 contract event with the same transaction hash as the transfer event.
    // If there is not, then this is an external transfer.
    if (!allVotingV2Events.some((stakedEvent) => stakedEvent.transactionHash === transferEvent.transactionHash)) {
      sumExternalTransfers = sumExternalTransfers.add(transferEvent.args.value);
    }
  }

  return sumExternalTransfers;
};

export const votingV2VotingBalanceWithoutExternalTransfers = async (
  votingToken: VotingTokenEthers,
  votingV2: VotingV2Ethers
): Promise<BigNumber> => {
  const votingV2Balance = await votingToken.balanceOf(votingV2.address);
  const externalVotingTokenTransfers = await getVotingTokenExternalTransfersAmount(votingToken, votingV2);
  return votingV2Balance.sub(externalVotingTokenTransfers);
};

export const unstakeFromStakedAccount = async (votingV2: VotingV2Ethers, voter: string): Promise<void> => {
  let stakeBalance = await votingV2.callStatic.getVoterStakePostUpdate(voter);

  if (stakeBalance.gt(ethers.BigNumber.from(0))) {
    console.log("Unstaking from", voter, stakeBalance.toString());
    const impersonatedSigner = await ethers.getImpersonatedSigner(voter);
    const voterStake = await votingV2.voterStakes(voter);
    if (voterStake.pendingUnstake.gt(ethers.BigNumber.from(0))) {
      console.log("Staker", voter, "has a pending unstake. Executing then re-unstaking");
      const unstakeTime = voterStake.unstakeTime;
      const currentTime = await votingV2.getCurrentTime();
      const pendingStakeRemainingTime = unstakeTime.gt(currentTime) ? unstakeTime.sub(currentTime) : BigNumber.from(0);
      await increaseEvmTime(pendingStakeRemainingTime.toNumber());
      const tx = await votingV2.connect(impersonatedSigner).executeUnstake();
      await tx.wait();
    }

    // Move time to the next commit phase if in active reveal phase.
    const inActiveRevealPhase = (await votingV2.currentActiveRequests()) && (await votingV2.getVotePhase()) == 1;
    if (inActiveRevealPhase) {
      const phaseLength = await votingV2.voteTiming();
      const currentTime = await votingV2.getCurrentTime();
      let newTime = currentTime;
      const isCommitPhase = newTime.div(phaseLength).mod(2).eq(0);
      if (!isCommitPhase) {
        newTime = newTime.add(phaseLength.sub(newTime.mod(phaseLength)));
      }
      await increaseEvmTime(newTime.sub(currentTime).toNumber());
    }

    stakeBalance = await votingV2.callStatic.getVoterStakePostUpdate(voter);
    const tx = await votingV2.connect(impersonatedSigner).requestUnstake(stakeBalance);
    await tx.wait();
  }

  await increaseEvmTime((await votingV2.unstakeCoolDown()).toNumber());

  const pendingUnstake = (await votingV2.voterStakes(voter)).pendingUnstake;
  if (pendingUnstake.gt(ethers.BigNumber.from(0))) {
    console.log("Executing unstake from", voter, pendingUnstake.toString());
    const impersonatedSigner = await ethers.getImpersonatedSigner(voter);
    const tx = await votingV2.connect(impersonatedSigner).executeUnstake();
    await tx.wait();
  }
};
