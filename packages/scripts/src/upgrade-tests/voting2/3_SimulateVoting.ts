const hre = require("hardhat");
const assert = require("assert").strict;

const { formatBytes32String, formatEther, parseEther, parseUnits, toUtf8Bytes } = hre.ethers.utils;

import { BigNumber, BigNumberish, BytesLike } from "ethers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";

import {
  computeVoteHashAncillary,
  getRandomSignedInt,
  interfaceName,
  OptimisticOracleRequestStatesEnum,
  PriceRequestStatusEnum,
} from "@uma/common";
import {
  FinderEthers,
  OptimisticOracleV2Ethers,
  StoreEthers,
  VotingTokenEthers,
  VotingV2Ethers,
} from "@uma/contracts-node";

import { FOUNDATION_WALLET, getContractInstance, SECONDS_PER_DAY } from "../../utils/contracts";
import { increaseEvmTime } from "../../utils/utils";
import { isVotingV2Instance } from "./migrationUtils";

interface VotingPriceRequest {
  identifier: BytesLike;
  time: BigNumberish;
  ancillaryData: BytesLike;
}

interface PriceRequestData {
  originalAncillaryData: BytesLike;
  proposedPrice: BigNumberish;
  priceRequest: VotingPriceRequest;
}
interface CommittedVote {
  priceRequest: VotingPriceRequest;
  salt: BigNumberish;
  price: BigNumberish;
  voteHash: BytesLike;
}

interface RewardTrackers {
  lastUpdateTimestamp: BigNumber;
  staked: [BigNumber, BigNumber, BigNumber];
  unclaimedRewards: [BigNumber, BigNumber, BigNumber];
}

const zeroBigNumber: BigNumber = hre.ethers.BigNumber.from(0);

// Constants hardcoded in the SlashingLibrary, needs to be updated here upon change.
const wrongVoteSlashPerToken = parseEther("0.0016");
const noVoteSlashPerToken = parseEther("0.0016");

// Initial voter balances relative to GAT.
const voter1RelativeGatFunding = parseEther("0.6");
const voter2RelativeGatFunding = parseEther("0.55");
const voter3RelativeGatFunding = parseEther("0.5");

// Tested price identifier should be whitelisted.
const priceIdentifier = formatBytes32String("NUMERICAL");

async function main() {
  const rewardTrackers: RewardTrackers = {
    lastUpdateTimestamp: zeroBigNumber,
    staked: [zeroBigNumber, zeroBigNumber, zeroBigNumber],
    unclaimedRewards: [zeroBigNumber, zeroBigNumber, zeroBigNumber],
  };

  // Initiates data request through Optimistic Oracle by requesting, proposing and diputing.
  // Returns stamped ancillary data to be used in voting.
  async function _requestProposeDispute(priceRequestData: PriceRequestData): Promise<BytesLike> {
    await (
      await optimisticOracleV2
        .connect(requesterSigner)
        .requestPrice(
          priceRequestData.priceRequest.identifier,
          priceRequestData.priceRequest.time,
          priceRequestData.originalAncillaryData,
          votingToken.address,
          0
        )
    ).wait();
    await (await votingToken.connect(requesterSigner).approve(optimisticOracleV2.address, finalFee.mul(4))).wait();
    await (
      await optimisticOracleV2
        .connect(requesterSigner)
        .proposePrice(
          requesterSigner.address,
          priceRequestData.priceRequest.identifier,
          priceRequestData.priceRequest.time,
          priceRequestData.originalAncillaryData,
          priceRequestData.proposedPrice
        )
    ).wait();
    await (
      await optimisticOracleV2
        .connect(requesterSigner)
        .disputePrice(
          requesterSigner.address,
          priceRequestData.priceRequest.identifier,
          priceRequestData.priceRequest.time,
          priceRequestData.originalAncillaryData
        )
    ).wait();
    return await optimisticOracleV2.stampAncillaryData(priceRequestData.originalAncillaryData, requesterSigner.address);
  }

  // Construct voting structure for commit and reveal.
  async function _createVote(priceRequest: VotingPriceRequest, voter: string, price: string): Promise<CommittedVote> {
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

  async function _commitVote(signer: SignerWithAddress, vote: CommittedVote): Promise<void> {
    (
      await votingV2
        .connect(signer)
        .commitVote(
          vote.priceRequest.identifier,
          vote.priceRequest.time,
          vote.priceRequest.ancillaryData,
          vote.voteHash
        )
    ).wait();
  }

  async function _revealVote(signer: SignerWithAddress, vote: CommittedVote): Promise<void> {
    (
      await votingV2
        .connect(signer)
        .revealVote(
          vote.priceRequest.identifier,
          vote.priceRequest.time,
          vote.price,
          vote.priceRequest.ancillaryData,
          vote.salt
        )
    ).wait();
  }

  async function _getOptimisticOracleState(priceRequestData: PriceRequestData): Promise<number> {
    return optimisticOracleV2.getState(
      requesterSigner.address,
      priceRequestData.priceRequest.identifier,
      priceRequestData.priceRequest.time,
      priceRequestData.originalAncillaryData
    );
  }

  // Replicates Optimistic Oracle settleAndGetPrice, but returns price when called from EOA.
  async function _settleAndGetPrice(priceRequestData: PriceRequestData): Promise<BigNumberish> {
    if (
      (
        await optimisticOracleV2.getState(
          requesterSigner.address,
          priceRequestData.priceRequest.identifier,
          priceRequestData.priceRequest.time,
          priceRequestData.originalAncillaryData
        )
      ).toString() !== OptimisticOracleRequestStatesEnum.SETTLED
    ) {
      await optimisticOracleV2
        .connect(requesterSigner)
        .settle(
          requesterSigner.address,
          priceRequestData.priceRequest.identifier,
          priceRequestData.priceRequest.time,
          priceRequestData.originalAncillaryData
        );
    }
    return (
      await optimisticOracleV2.getRequest(
        requesterSigner.address,
        priceRequestData.priceRequest.identifier,
        priceRequestData.priceRequest.time,
        priceRequestData.originalAncillaryData
      )
    ).resolvedPrice;
  }

  // Updates accrued rewards for all stakers whenever anyone stakes/unstakes. This is slightly different form actual
  // contract implementation where only relevant staker's rewards get updated and could cause difference at higher
  // precision. Thus, _reducePrecision function is used in assertions.
  async function _updateRewardTrackers(stakingVoterIndex: number, netStakedAmount: BigNumber): Promise<void> {
    const currentTime = await votingV2.getCurrentTime();
    const totalStaked = rewardTrackers.staked.reduce<BigNumber>(
      (currentTotal, currentVoterAmount) => currentTotal.add(currentVoterAmount),
      zeroBigNumber
    );
    const totalPeriodRewards =
      !totalStaked.isZero() && !rewardTrackers.lastUpdateTimestamp.isZero()
        ? currentTime.sub(rewardTrackers.lastUpdateTimestamp).mul(emissionRate)
        : zeroBigNumber;
    if (!totalPeriodRewards.isZero()) {
      rewardTrackers.staked.forEach((voterStake, voterIndex) => {
        const voterPeriodRewards = totalPeriodRewards.mul(voterStake).div(totalStaked);
        rewardTrackers.unclaimedRewards[voterIndex] = rewardTrackers.unclaimedRewards[voterIndex].add(
          voterPeriodRewards
        );
      });
    }
    rewardTrackers.lastUpdateTimestamp = currentTime;
    rewardTrackers.staked[stakingVoterIndex] = rewardTrackers.staked[stakingVoterIndex].add(netStakedAmount);
  }

  function _reducePrecision(rawValue: BigNumber, precisionLost: number): BigNumber {
    return rawValue.div(parseUnits("1", precisionLost)).mul(parseUnits("1", precisionLost));
  }

  console.log("🎭 Running Voting Simulation after V2 upgrade...");

  if (hre.network.name != "localhost") throw new Error("Voting should be only tested in simulation!");

  const finder = await getContractInstance<FinderEthers>("Finder");
  const optimisticOracleV2 = await getContractInstance<OptimisticOracleV2Ethers>("OptimisticOracleV2");
  const store = await getContractInstance<StoreEthers>("Store");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const votingV2Address = await finder.getImplementationAddress(formatBytes32String(interfaceName.Oracle));
  if (!(await isVotingV2Instance(votingV2Address))) throw new Error("Oracle is not VotingV2 instance!");

  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2", votingV2Address);

  const emissionRate = await votingV2.emissionRate();
  const gat = await votingV2.gat();
  const unstakeCoolDown = await votingV2.unstakeCoolDown();
  const finalFee = (await store.computeFinalFee(votingToken.address)).rawValue;

  let foundationBalance = await votingToken.balanceOf(FOUNDATION_WALLET);
  console.log(` 1. Foundation has ${formatEther(foundationBalance)} UMA, funding requester and voters...`);

  // There will be 3 voters with initial balances set relative to GAT, and for two disputed price
  // price requests 8 * finalFee amount will be needed (Optimistic Oracle bond defaults to finalFee).
  if (
    foundationBalance.lt(
      gat
        .mul(voter1RelativeGatFunding.add(voter2RelativeGatFunding.add(voter3RelativeGatFunding)))
        .div(parseEther("1"))
        .add(finalFee.mul(8))
    )
  )
    throw new Error("Foundation balance too low for simulation!");

  const foundationSigner: SignerWithAddress = await hre.ethers.getSigner(FOUNDATION_WALLET);
  const [
    requesterSigner,
    voter1Signer,
    voter2Signer,
    voter3Signer,
  ]: SignerWithAddress[] = await hre.ethers.getSigners();

  let [requesterBalance, voter1Balance, voter2Balance, voter3Balance] = await Promise.all(
    [requesterSigner, voter1Signer, voter2Signer, voter3Signer].map((signer) => {
      return votingToken.balanceOf(signer.address);
    })
  );

  // Transfering required balances. This assumes recipient accounts did not have more than target amounts before
  // simulation.
  await (
    await votingToken.connect(foundationSigner).transfer(requesterSigner.address, finalFee.mul(8).sub(requesterBalance))
  ).wait();
  await (
    await votingToken
      .connect(foundationSigner)
      .transfer(voter1Signer.address, gat.mul(voter1RelativeGatFunding).div(parseEther("1").sub(voter1Balance)))
  ).wait();
  await (
    await votingToken
      .connect(foundationSigner)
      .transfer(voter2Signer.address, gat.mul(voter2RelativeGatFunding).div(parseEther("1").sub(voter2Balance)))
  ).wait();
  await (
    await votingToken
      .connect(foundationSigner)
      .transfer(voter3Signer.address, gat.mul(voter3RelativeGatFunding).div(parseEther("1").sub(voter3Balance)))
  ).wait();

  [requesterBalance, voter1Balance, voter2Balance, voter3Balance] = await Promise.all(
    [requesterSigner, voter1Signer, voter2Signer, voter3Signer].map((signer) => {
      return votingToken.balanceOf(signer.address);
    })
  );

  console.log(` ✅ Requester now has ${formatEther(requesterBalance)} UMA.`);
  console.log(` ✅ Voter 1 now has ${formatEther(voter1Balance)} UMA.`);
  console.log(` ✅ Voter 2 now has ${formatEther(voter2Balance)} UMA.`);
  console.log(` ✅ Voter 3 now has ${formatEther(voter3Balance)} UMA.`);

  console.log(" 2. Voters are staking all their UMA...");
  await (await votingToken.connect(voter1Signer).approve(votingV2.address, voter1Balance)).wait();
  await (await votingToken.connect(voter2Signer).approve(votingV2.address, voter2Balance)).wait();
  await (await votingToken.connect(voter3Signer).approve(votingV2.address, voter3Balance)).wait();
  console.log(" ✅ Approvals on the voting contract done.");

  await (await votingV2.connect(voter1Signer).stake(voter1Balance)).wait();
  await _updateRewardTrackers(0, voter1Balance);
  await (await votingV2.connect(voter2Signer).stake(voter2Balance)).wait();
  await _updateRewardTrackers(1, voter2Balance);
  await (await votingV2.connect(voter3Signer).stake(voter3Balance)).wait();
  await _updateRewardTrackers(2, voter3Balance);
  console.log(" ✅ Voters have staked all their UMA.");

  console.log(" 3. Waiting till the start of the next voting cycle...");
  await increaseEvmTime(
    Number((await votingV2.getRoundEndTime(await votingV2.getCurrentRoundId())).sub(await votingV2.getCurrentTime()))
  );
  let currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  console.log(" 4. Adding the first data request...");
  const firstRequestData: PriceRequestData = {
    originalAncillaryData: toUtf8Bytes(`q:"Really hard question, maybe 100, maybe 90?"`),
    proposedPrice: "100",
    priceRequest: { identifier: priceIdentifier, time: currentTime } as VotingPriceRequest,
  };
  firstRequestData.priceRequest.ancillaryData = await _requestProposeDispute(firstRequestData);
  assert.equal(
    (await votingV2.getPriceRequestStatuses([firstRequestData.priceRequest]))[0].status.toString(),
    PriceRequestStatusEnum.FUTURE
  );
  console.log(" ✅ Verified the first data request enqueued for future voting round.");

  console.log(" 5. Waiting till the start of the next voting cycle...");
  await increaseEvmTime(
    Number((await votingV2.getRoundEndTime(await votingV2.getCurrentRoundId())).sub(await votingV2.getCurrentTime()))
  );
  currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  assert.equal(
    (await votingV2.getPriceRequestStatuses([firstRequestData.priceRequest]))[0].status.toString(),
    PriceRequestStatusEnum.ACTIVE
  );
  console.log(" ✅ Verified the first data request can be voted in the current round.");

  console.log(" 6. Not reaching quorum on the first data request...");
  // Only the Voter 1 participates, below GAT.
  let voter1FirstRequestVote = await _createVote(firstRequestData.priceRequest, voter1Signer.address, "90");
  await _commitVote(voter1Signer, voter1FirstRequestVote);
  console.log(" ✅ Voter 1 committed.");

  await increaseEvmTime(SECONDS_PER_DAY);
  currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  await _revealVote(voter1Signer, voter1FirstRequestVote);
  console.log(" ✅ Voter 1 revealed.");

  await increaseEvmTime(SECONDS_PER_DAY);
  currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  assert.equal(
    (await _getOptimisticOracleState(firstRequestData)).toString(),
    OptimisticOracleRequestStatesEnum.DISPUTED
  );
  console.log(" ✅ Verified the first data request is not yet resolved.");

  console.log(" 7. Requesting unstake...");
  assert.equal(
    (await votingV2.callStatic.getVoterStakePostUpdate(voter1Signer.address)).toString(),
    voter1Balance.toString()
  );
  assert.equal(
    (await votingV2.callStatic.getVoterStakePostUpdate(voter2Signer.address)).toString(),
    voter2Balance.toString()
  );
  assert.equal(
    (await votingV2.callStatic.getVoterStakePostUpdate(voter3Signer.address)).toString(),
    voter3Balance.toString()
  );
  console.log(" ✅ Verified that no slashing has been applied to staked balances.");

  await (await votingV2.connect(voter1Signer).requestUnstake(voter1Balance)).wait();
  await _updateRewardTrackers(0, voter1Balance.mul("-1"));
  await (await votingV2.connect(voter2Signer).requestUnstake(voter2Balance)).wait();
  await _updateRewardTrackers(1, voter2Balance.mul("-1"));
  await (await votingV2.connect(voter3Signer).requestUnstake(voter3Balance)).wait();
  await _updateRewardTrackers(2, voter3Balance.mul("-1"));
  console.log(" ✅ Voters requested unstake of all UMA.");

  console.log(" 8. Waiting for unstake cooldown...");
  await increaseEvmTime(Number(unstakeCoolDown));
  currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  console.log(" 9. Executing unstake...");
  await (await votingV2.connect(voter1Signer).executeUnstake()).wait();
  await (await votingV2.connect(voter2Signer).executeUnstake()).wait();
  await (await votingV2.connect(voter3Signer).executeUnstake()).wait();
  console.log(" ✅ Voters have unstaked all UMA.");

  console.log(" 10. Claiming staking rewards...");
  await (await votingV2.connect(voter1Signer).withdrawRewards()).wait();
  await (await votingV2.connect(voter2Signer).withdrawRewards()).wait();
  await (await votingV2.connect(voter3Signer).withdrawRewards()).wait();
  const voter1Rewards = (await votingToken.balanceOf(voter1Signer.address)).sub(voter1Balance);
  const voter2Rewards = (await votingToken.balanceOf(voter2Signer.address)).sub(voter2Balance);
  const voter3Rewards = (await votingToken.balanceOf(voter3Signer.address)).sub(voter3Balance);
  console.log(` ✅ Voter 1 has claimed ${formatEther(voter1Rewards)} UMA.`);
  console.log(` ✅ Voter 2 has claimed ${formatEther(voter2Rewards)} UMA.`);
  console.log(` ✅ Voter 3 has claimed ${formatEther(voter3Rewards)} UMA.`);

  assert.equal(
    _reducePrecision(voter1Rewards, 10).toString(),
    _reducePrecision(rewardTrackers.unclaimedRewards[0], 10).toString()
  );
  assert.equal(
    _reducePrecision(voter2Rewards, 10).toString(),
    _reducePrecision(rewardTrackers.unclaimedRewards[1], 10).toString()
  );
  assert.equal(
    _reducePrecision(voter3Rewards, 10).toString(),
    _reducePrecision(rewardTrackers.unclaimedRewards[2], 10).toString()
  );
  rewardTrackers.unclaimedRewards[0] = zeroBigNumber;
  rewardTrackers.unclaimedRewards[1] = zeroBigNumber;
  rewardTrackers.unclaimedRewards[2] = zeroBigNumber;
  console.log(` ✅ Verified that all reward amounts are correct.`);

  console.log(" 11. Voters are restaking original balances...");
  await (await votingToken.connect(voter1Signer).approve(votingV2.address, voter1Balance)).wait();
  await (await votingToken.connect(voter2Signer).approve(votingV2.address, voter2Balance)).wait();
  await (await votingToken.connect(voter3Signer).approve(votingV2.address, voter3Balance)).wait();
  console.log(" ✅ Approvals on the voting contract done.");

  await (await votingV2.connect(voter1Signer).stake(voter1Balance)).wait();
  await (await votingV2.connect(voter2Signer).stake(voter2Balance)).wait();
  await (await votingV2.connect(voter3Signer).stake(voter3Balance)).wait();
  console.log(" ✅ Voters have restaked original balances.");

  console.log(" 12. Waiting till the start of the next voting cycle...");
  await increaseEvmTime(
    Number((await votingV2.getRoundEndTime(await votingV2.getCurrentRoundId())).sub(await votingV2.getCurrentTime()))
  );
  currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  console.log(" 13. Adding the second data request...");
  const secondRequestData: PriceRequestData = {
    originalAncillaryData: toUtf8Bytes(`q:"How much is 60 times two?"`),
    proposedPrice: "120",
    priceRequest: { identifier: priceIdentifier, time: currentTime } as VotingPriceRequest,
  };
  secondRequestData.priceRequest.ancillaryData = await _requestProposeDispute(secondRequestData);
  assert.equal(
    (await votingV2.getPriceRequestStatuses([secondRequestData.priceRequest]))[0].status.toString(),
    PriceRequestStatusEnum.FUTURE
  );
  console.log(" ✅ Verified the second data request enqueued for future voting round.");

  console.log(" 14. Waiting till the start of the next voting cycle...");
  await increaseEvmTime(
    Number((await votingV2.getRoundEndTime(await votingV2.getCurrentRoundId())).sub(await votingV2.getCurrentTime()))
  );
  currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  assert.equal(
    (await votingV2.getPriceRequestStatuses([secondRequestData.priceRequest]))[0].status.toString(),
    PriceRequestStatusEnum.ACTIVE
  );
  console.log(" ✅ Verified the second data request can be voted in the current round.");

  console.log(" 15. Resolving both data requests...");
  voter1FirstRequestVote = await _createVote(firstRequestData.priceRequest, voter1Signer.address, "90");
  const voter1SecondRequestVote = await _createVote(
    secondRequestData.priceRequest,
    voter1Signer.address,
    secondRequestData.proposedPrice.toString()
  );
  await _commitVote(voter1Signer, voter1FirstRequestVote);
  await _commitVote(voter1Signer, voter1SecondRequestVote);
  console.log(" ✅ Voter 1 committed on both requests.");

  const voter2FirstRequestVote = await _createVote(
    firstRequestData.priceRequest,
    voter2Signer.address,
    firstRequestData.proposedPrice.toString()
  );
  await _commitVote(voter2Signer, voter2FirstRequestVote);
  console.log(" ✅ Voter 2 committed on the first request.");

  const voter3SecondRequestVote = await _createVote(
    secondRequestData.priceRequest,
    voter3Signer.address,
    secondRequestData.proposedPrice.toString()
  );
  await _commitVote(voter3Signer, voter3SecondRequestVote);
  console.log(" ✅ Voter 3 committed on the second request.");

  await increaseEvmTime(SECONDS_PER_DAY);
  currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  await _revealVote(voter1Signer, voter1FirstRequestVote);
  await _revealVote(voter1Signer, voter1SecondRequestVote);
  await _revealVote(voter2Signer, voter2FirstRequestVote);
  await _revealVote(voter3Signer, voter3SecondRequestVote);
  console.log(" ✅ Voters revealed.");

  await increaseEvmTime(SECONDS_PER_DAY);
  currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  assert.equal(
    (await _getOptimisticOracleState(firstRequestData)).toString(),
    OptimisticOracleRequestStatesEnum.RESOLVED
  );
  assert.equal(
    (await _getOptimisticOracleState(secondRequestData)).toString(),
    OptimisticOracleRequestStatesEnum.RESOLVED
  );
  console.log(" ✅ Verified both data requests are now resolved.");

  console.log(" 16. Settling requests...");
  // Voter 1 voted on both requests and since it has the largest stake its voted price should be the right one as only
  // two voters participated in each vote.
  const correctFirstPrice = voter1FirstRequestVote.price.toString();
  const correctSecondPrice = voter1SecondRequestVote.price.toString();
  assert.equal((await _settleAndGetPrice(firstRequestData)).toString(), correctFirstPrice);
  assert.equal((await _settleAndGetPrice(secondRequestData)).toString(), correctSecondPrice);
  console.log(" ✅ Verified that correct prices are available to the requester.");

  console.log(" 17. Verifying slashing...");
  // Voter 2 voted wrong and Voter 3 missed the first request.
  const expectedVoter2FirstSlash = voter2Balance.mul(wrongVoteSlashPerToken).div(parseEther("1"));
  const expectedVoter3FirstSlash = voter3Balance.mul(noVoteSlashPerToken).div(parseEther("1"));
  // Voter 2 missed the second request.
  const expectedVoter2SecondSlash = voter2Balance.mul(noVoteSlashPerToken).div(parseEther("1"));
  // Voter 1 gets all the slashing from other stakers in the first request.
  const expectedVoter1FirstSlash = expectedVoter2FirstSlash.add(expectedVoter3FirstSlash).mul("-1");
  // Voter 1 and 3 shares slashing from Voter 2 in the second request.
  const expectedVoter1SecondSlash = expectedVoter2SecondSlash
    .mul(voter1Balance)
    .div(voter1Balance.add(voter3Balance))
    .mul("-1");
  const expectedVoter3SecondSlash = expectedVoter2SecondSlash.add(expectedVoter1SecondSlash).mul("-1");

  const voter1Slash = voter1Balance.sub(await votingV2.callStatic.getVoterStakePostUpdate(voter1Signer.address));
  const voter2Slash = voter2Balance.sub(await votingV2.callStatic.getVoterStakePostUpdate(voter2Signer.address));
  const voter3Slash = voter3Balance.sub(await votingV2.callStatic.getVoterStakePostUpdate(voter3Signer.address));
  assert.equal(voter1Slash.toString(), expectedVoter1FirstSlash.add(expectedVoter1SecondSlash).toString());
  assert.equal(voter2Slash.toString(), expectedVoter2FirstSlash.add(expectedVoter2SecondSlash).toString());
  assert.equal(voter3Slash.toString(), expectedVoter3FirstSlash.add(expectedVoter3SecondSlash).toString());
  console.log(` ✅ Verified the slashing amounts are correct.`);
  console.log(` ✅ Voter 1 was slashed by ${formatEther(voter1Slash)} UMA.`);
  console.log(` ✅ Voter 2 was slashed by ${formatEther(voter2Slash)} UMA.`);
  console.log(` ✅ Voter 3 was slashed by ${formatEther(voter3Slash)} UMA.`);

  console.log(" 18. Requesting unstake...");
  await (
    await votingV2
      .connect(voter1Signer)
      .requestUnstake(await votingV2.callStatic.getVoterStakePostUpdate(voter1Signer.address))
  ).wait();
  await (
    await votingV2
      .connect(voter2Signer)
      .requestUnstake(await votingV2.callStatic.getVoterStakePostUpdate(voter2Signer.address))
  ).wait();
  await (
    await votingV2
      .connect(voter3Signer)
      .requestUnstake(await votingV2.callStatic.getVoterStakePostUpdate(voter3Signer.address))
  ).wait();
  console.log(" ✅ Voters requested unstake of all UMA.");

  console.log(" 19. Waiting for unstake cooldown...");
  await increaseEvmTime(Number(unstakeCoolDown));
  currentTime = await votingV2.getCurrentTime();
  console.log(` ✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  console.log(" 20. Executing unstake...");
  await (await votingV2.connect(voter1Signer).executeUnstake()).wait();
  await (await votingV2.connect(voter2Signer).executeUnstake()).wait();
  await (await votingV2.connect(voter3Signer).executeUnstake()).wait();
  console.log(" ✅ Voters have unstaked all UMA.");

  console.log(" 21. Claiming staking rewards...");
  await (await votingV2.connect(voter1Signer).withdrawRewards()).wait();
  await (await votingV2.connect(voter2Signer).withdrawRewards()).wait();
  await (await votingV2.connect(voter3Signer).withdrawRewards()).wait();
  // TODO: verify claimed reward amounts.

  console.log(" 22. Returning all UMA to the foundation...");
  await votingToken
    .connect(requesterSigner)
    .transfer(foundationSigner.address, await votingToken.balanceOf(requesterSigner.address));
  await votingToken
    .connect(voter1Signer)
    .transfer(foundationSigner.address, await votingToken.balanceOf(voter1Signer.address));
  await votingToken
    .connect(voter2Signer)
    .transfer(foundationSigner.address, await votingToken.balanceOf(voter2Signer.address));
  await votingToken
    .connect(voter3Signer)
    .transfer(foundationSigner.address, await votingToken.balanceOf(voter3Signer.address));

  foundationBalance = await votingToken.balanceOf(FOUNDATION_WALLET);
  console.log(` ✅ Foundation has ${formatEther(foundationBalance)} UMA.`);

  console.log("\n💪 Verified! The upgraded DVM is functional.");
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
