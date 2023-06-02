import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { computeVoteHashAncillary, getRandomSignedInt, paginatedEventQuery } from "@uma/common";
import { VotingTokenEthers, VotingV2Ethers, TypedEventFilterEthers as TypedEventFilter } from "@uma/contracts-node";
import { BigNumber, BigNumberish, BytesLike, Signer } from "ethers";
import { getContractInstance } from "./contracts";
import { forkNetwork, getForkChainId, increaseEvmTime } from "./utils";
import { StakedEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/VotingV2";
import { VoterSlashedEvent } from "@uma/contracts-node/typechain/core/ethers/VotingV2";
import { TransferEvent } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers/ERC20";

const hre = require("hardhat");
const { ethers } = hre;

export interface VotingPriceRequest {
  identifier: BytesLike;
  time: BigNumberish;
  ancillaryData: BytesLike;
}

export interface CommittedVote {
  priceRequest: VotingPriceRequest;
  salt: BigNumberish;
  price: BigNumberish;
  voteHash: BytesLike;
}

const getVotingV2EventSearchConfig = async (votingV2: VotingV2Ethers) => {
  return {
    fromBlock: 16697232, // VotingV2 deployment block
    toBlock: await votingV2.provider.getBlockNumber(),
    maxBlockLookBack: 20000, // Mainnet max block lookback
  };
};

export const getVotingContracts = async (): Promise<{ votingV2: VotingV2Ethers; votingToken: VotingTokenEthers }> => {
  let chainId: number;
  if (hre.network.name === "localhost") {
    chainId = (await ethers.provider.getNetwork()).chainId;
  } else {
    if (!process.env.CUSTOM_NODE_URL) throw new Error("CUSTOM_NODE_URL must be defined in env");
    await forkNetwork(process.env.CUSTOM_NODE_URL);
    chainId = await getForkChainId(process.env.CUSTOM_NODE_URL);
  }

  if (!chainId || (chainId != 1 && chainId != 5)) throw new Error("This script should be run on mainnet or goerli");

  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2", undefined, chainId);
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken", undefined, chainId);
  return { votingV2, votingToken };
};

export const getUniqueVoters = async (votingV2: VotingV2Ethers): Promise<string[]> => {
  const searchConfig = await getVotingV2EventSearchConfig(votingV2);
  const stakedEvents = (await paginatedEventQuery<StakedEvent>(
    votingV2,
    votingV2.filters.Staked(null, null, null),
    searchConfig
  )) as StakedEvent[];
  const uniqueVoters = new Set<string>(stakedEvents.map((event) => event.args.voter));
  return Array.from(uniqueVoters);
};

export const updateTrackers = async (votingV2: VotingV2Ethers, voters: string[]): Promise<void> => {
  console.log("Updating trackers for all voters");
  const priceRequests = await votingV2.callStatic.getNumberOfPriceRequestsPostUpdate();
  const batchSize = 10;
  const batches = [];
  for (let i = 0; i < voters.length; i += batchSize) {
    const batch = voters.slice(i, i + batchSize);
    batches.push(
      (async () => {
        try {
          await votingV2
            .multicall(batch.map((voter) => votingV2.interface.encodeFunctionData("updateTrackers", [voter])))
            .then((tx) => tx.wait());
        } catch {
          for (const voter of batch) {
            try {
              await votingV2.updateTrackers(voter);
            } catch (err) {
              console.log(`Error updating trackers for voter: ${voter}`);
              let voterStake = await votingV2.voterStakes(voter);
              while (!voterStake.nextIndexToProcess.eq(priceRequests[1].sub(1))) {
                await votingV2.updateTrackersRange(voter, 10);
                voterStake = await votingV2.voterStakes(voter);
              }
              console.log("Finished updateTrackersRange for voter");
            }
          }
        }
      })()
    );
  }
  await Promise.all(batches);
  console.log("Done updating trackers for all voters");
};

export const getSumSlashedEvents = async (votingV2: VotingV2Ethers): Promise<BigNumber> => {
  const searchConfig = await getVotingV2EventSearchConfig(votingV2);
  const voterSlashedEvents = (await paginatedEventQuery<VoterSlashedEvent>(
    votingV2,
    votingV2.filters.VoterSlashed(),
    searchConfig
  )) as VoterSlashedEvent[];
  return voterSlashedEvents
    .map((voterSlashedEvent) => voterSlashedEvent.args.slashedTokens)
    .reduce((a, b) => a.add(b), ethers.BigNumber.from(0));
};

export const getNumberSlashedEvents = async (votingV2: VotingV2Ethers): Promise<number> => {
  const searchConfig = await getVotingV2EventSearchConfig(votingV2);
  const voterSlashedEvents = (await paginatedEventQuery<VoterSlashedEvent>(
    votingV2,
    votingV2.filters.VoterSlashed(),
    searchConfig
  )) as VoterSlashedEvent[];
  return voterSlashedEvents.length;
};

export const getVotingTokenExternalTransfersAmount = async (
  votingToken: VotingTokenEthers,
  votingV2: VotingV2Ethers
): Promise<BigNumber> => {
  const searchConfig = await getVotingV2EventSearchConfig(votingV2);
  const transferEvents = (await paginatedEventQuery<TransferEvent>(
    votingToken,
    votingToken.filters.Transfer(null, votingV2.address, null),
    searchConfig
  )) as TransferEvent[];

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
  // Set the balance of the voter to 10 ETH so that they can unstake.
  await hre.network.provider.send("hardhat_setBalance", [voter, hre.ethers.utils.parseEther("10.0").toHexString()]);

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

// Construct voting structure for commit and reveal.
export async function createCommittedVote(
  votingV2: VotingV2Ethers,
  priceRequest: VotingPriceRequest,
  voter: string,
  price: string
): Promise<CommittedVote> {
  const salt = getRandomSignedInt().toString();
  const roundId = Number(await votingV2.getCurrentRoundId());
  const voteHash = computeVoteHashAncillary({
    price,
    salt,
    account: voter,
    time: Number(priceRequest.time),
    roundId,
    identifier: priceRequest.identifier.toString(),
    ancillaryData: priceRequest.ancillaryData.toString(),
  });
  return <CommittedVote>{ priceRequest, salt, price, voteHash };
}

export async function commitVote(
  votingV2: VotingV2Ethers,
  signer: SignerWithAddress,
  vote: CommittedVote
): Promise<void> {
  (
    await votingV2
      .connect(signer as Signer)
      .commitVote(vote.priceRequest.identifier, vote.priceRequest.time, vote.priceRequest.ancillaryData, vote.voteHash)
  ).wait();
}

export async function revealVote(
  votingV2: VotingV2Ethers,
  signer: SignerWithAddress,
  vote: CommittedVote
): Promise<void> {
  (
    await votingV2
      .connect(signer as Signer)
      .revealVote(
        vote.priceRequest.identifier,
        vote.priceRequest.time,
        vote.price,
        vote.priceRequest.ancillaryData,
        vote.salt
      )
  ).wait();
}
