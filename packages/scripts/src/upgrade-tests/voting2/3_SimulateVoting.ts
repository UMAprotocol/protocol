const hre = require("hardhat");
const assert = require("assert").strict;

const { formatBytes32String, formatEther, parseEther, toUtf8Bytes } = hre.ethers.utils;

import { BigNumberish, BytesLike, Signer } from "ethers";

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
  requesterAddress: string;
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

// Initial voter balances relative to GAT.
const voter1RelativeGatFunding = parseEther("0.6");
const voter2RelativeGatFunding = parseEther("0.55");
const voter3RelativeGatFunding = parseEther("0.5");

// Tested price identifier should be whitelisted.
const priceIdentifier = formatBytes32String("YES_OR_NO_QUERY");

async function main() {
  // Initiates data request through Optimistic Oracle by requesting, proposing and diputing.
  // Returns stamped ancillary data to be used in voting.
  async function _requestProposeDispute(
    requesterSigner: Signer,
    priceRequestData: PriceRequestData
  ): Promise<BytesLike> {
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
          priceRequestData.requesterAddress,
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
          priceRequestData.requesterAddress,
          priceRequestData.priceRequest.identifier,
          priceRequestData.priceRequest.time,
          priceRequestData.originalAncillaryData
        )
    ).wait();
    return await optimisticOracleV2.stampAncillaryData(
      priceRequestData.originalAncillaryData,
      priceRequestData.requesterAddress
    );
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

  async function _commitVote(signer: Signer, vote: CommittedVote): Promise<void> {
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

  async function _revealVote(signer: Signer, vote: CommittedVote): Promise<void> {
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
      priceRequestData.requesterAddress,
      priceRequestData.priceRequest.identifier,
      priceRequestData.priceRequest.time,
      priceRequestData.originalAncillaryData
    );
  }

  console.log("🎭 Running Voting Simulation after V2 upgrade");

  if (hre.network.name != "localhost") throw new Error("Voting should be only tested in simulation!");

  const finder = await getContractInstance<FinderEthers>("Finder");
  const optimisticOracleV2 = await getContractInstance<OptimisticOracleV2Ethers>("OptimisticOracleV2");
  const store = await getContractInstance<StoreEthers>("Store");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const votingV2Address = await finder.getImplementationAddress(formatBytes32String(interfaceName.Oracle));
  if (!(await isVotingV2Instance(votingV2Address))) throw new Error("Oracle is not VotingV2 instance!");

  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2", votingV2Address);

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

  const foundationSigner: Signer = await hre.ethers.getSigner(FOUNDATION_WALLET);
  const [requesterSigner, voter1Signer, voter2Signer, voter3Signer]: Signer[] = await hre.ethers.getSigners();

  let [requesterBalance, voter1Balance, voter2Balance, voter3Balance] = await Promise.all(
    [requesterSigner, voter1Signer, voter2Signer, voter3Signer].map(async (signer) => {
      return votingToken.balanceOf(await signer.getAddress());
    })
  );

  // Transfering required balances. This assumes recipient accounts did not have more than target amounts before
  // simulation.
  await (
    await votingToken
      .connect(foundationSigner)
      .transfer(await requesterSigner.getAddress(), finalFee.mul(8).sub(requesterBalance))
  ).wait();
  await (
    await votingToken
      .connect(foundationSigner)
      .transfer(
        await voter1Signer.getAddress(),
        gat.mul(voter1RelativeGatFunding).div(parseEther("1").sub(voter1Balance))
      )
  ).wait();
  await (
    await votingToken
      .connect(foundationSigner)
      .transfer(
        await voter2Signer.getAddress(),
        gat.mul(voter2RelativeGatFunding).div(parseEther("1").sub(voter2Balance))
      )
  ).wait();
  await (
    await votingToken
      .connect(foundationSigner)
      .transfer(
        await voter3Signer.getAddress(),
        gat.mul(voter3RelativeGatFunding).div(parseEther("1").sub(voter3Balance))
      )
  ).wait();

  [requesterBalance, voter1Balance, voter2Balance, voter3Balance] = await Promise.all(
    [requesterSigner, voter1Signer, voter2Signer, voter3Signer].map(async (signer) => {
      return votingToken.balanceOf(await signer.getAddress());
    })
  );

  console.log(`✅ Requester now has ${formatEther(requesterBalance)} UMA.`);
  console.log(`✅ Voter 1 now has ${formatEther(voter1Balance)} UMA.`);
  console.log(`✅ Voter 2 now has ${formatEther(voter2Balance)} UMA.`);
  console.log(`✅ Voter 3 now has ${formatEther(voter3Balance)} UMA.`);

  console.log(" 2. Voters are staking all their UMA...");
  await (await votingToken.connect(voter1Signer).approve(votingV2.address, voter1Balance)).wait();
  await (await votingToken.connect(voter2Signer).approve(votingV2.address, voter2Balance)).wait();
  await (await votingToken.connect(voter3Signer).approve(votingV2.address, voter3Balance)).wait();
  console.log("✅ Approvals on VotingV2 done!");

  await (await votingV2.connect(voter1Signer).stake(voter1Balance)).wait();
  await (await votingV2.connect(voter2Signer).stake(voter2Balance)).wait();
  await (await votingV2.connect(voter3Signer).stake(voter3Balance)).wait();
  console.log("✅ Voters have staked all their UMA!");

  console.log(" 3. Waiting till the start of next voting cycle...");
  await increaseEvmTime(
    Number((await votingV2.getRoundEndTime(await votingV2.getCurrentRoundId())).sub(await votingV2.getCurrentTime()))
  );
  let currentTime = await votingV2.getCurrentTime();
  console.log(`✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);

  console.log(" 4. Adding the first data request...");
  const firstRequestData: PriceRequestData = {
    requesterAddress: await requesterSigner.getAddress(),
    originalAncillaryData: toUtf8Bytes("Really hard question."),
    proposedPrice: "100",
    priceRequest: { identifier: priceIdentifier, time: currentTime } as VotingPriceRequest,
  };
  firstRequestData.priceRequest.ancillaryData = await _requestProposeDispute(requesterSigner, firstRequestData);
  assert.equal(
    (await votingV2.getPriceRequestStatuses([firstRequestData.priceRequest]))[0].status.toString(),
    PriceRequestStatusEnum.FUTURE
  );
  console.log("✅ Verified the first data request enqueued for future voting round.");

  console.log(" 5. Waiting till the start of next voting cycle...");
  await increaseEvmTime(
    Number((await votingV2.getRoundEndTime(await votingV2.getCurrentRoundId())).sub(await votingV2.getCurrentTime()))
  );
  currentTime = await votingV2.getCurrentTime();
  console.log(`✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);
  assert.equal(
    (await votingV2.getPriceRequestStatuses([firstRequestData.priceRequest]))[0].status.toString(),
    PriceRequestStatusEnum.ACTIVE
  );
  console.log("✅ Verified the first data request can be voted in current round.");

  console.log(" 6. Not reaching quorum on first data request...");
  const voter1FirstVote = await _createVote(
    firstRequestData.priceRequest,
    await voter1Signer.getAddress(),
    firstRequestData.proposedPrice.toString()
  );
  await _commitVote(voter1Signer, voter1FirstVote);
  console.log("✅ First voter committed.");
  await increaseEvmTime(SECONDS_PER_DAY);
  currentTime = await votingV2.getCurrentTime();
  console.log(`✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);
  await _revealVote(voter1Signer, voter1FirstVote);
  console.log("✅ First voter revealed.");
  await increaseEvmTime(SECONDS_PER_DAY);
  currentTime = await votingV2.getCurrentTime();
  console.log(`✅ Time traveled to ${new Date(Number(currentTime.mul(1000))).toUTCString()}.`);
  assert.equal(
    (await _getOptimisticOracleState(firstRequestData)).toString(),
    OptimisticOracleRequestStatesEnum.DISPUTED
  );
  console.log("✅ Verified the first data request is not yet resolved.");

  console.log(" 5. Requesting unstake...");
  await (await votingV2.connect(voter1Signer).requestUnstake(voter1Balance)).wait();
  await (await votingV2.connect(voter2Signer).requestUnstake(voter2Balance)).wait();
  await (await votingV2.connect(voter3Signer).requestUnstake(voter3Balance)).wait();
  console.log("✅ Voters requested unstake of all UMA!");

  console.log(" 6. Waiting for unstake cooldown...");
  await increaseEvmTime(Number(unstakeCoolDown));
  console.log(`✅ Unstake colldown of ${Number(unstakeCoolDown)} seconds has passed!`);

  console.log(" 7. Executing unstake");
  await (await votingV2.connect(voter1Signer).executeUnstake()).wait();
  await (await votingV2.connect(voter2Signer).executeUnstake()).wait();
  await (await votingV2.connect(voter3Signer).executeUnstake()).wait();
  console.log("✅ Voters have unstaked all UMA!");

  console.log(" 8. Returning all UMA to the foundation...");
  await votingToken
    .connect(requesterSigner)
    .transfer(await foundationSigner.getAddress(), await votingToken.balanceOf(await requesterSigner.getAddress()));
  await votingToken
    .connect(voter1Signer)
    .transfer(await foundationSigner.getAddress(), await votingToken.balanceOf(await voter1Signer.getAddress()));
  await votingToken
    .connect(voter2Signer)
    .transfer(await foundationSigner.getAddress(), await votingToken.balanceOf(await voter2Signer.getAddress()));
  await votingToken
    .connect(voter3Signer)
    .transfer(await foundationSigner.getAddress(), await votingToken.balanceOf(await voter3Signer.getAddress()));

  foundationBalance = await votingToken.balanceOf(FOUNDATION_WALLET);
  console.log(`✅ Foundation has ${formatEther(foundationBalance)} UMA.`);

  console.log("\n✅ Verified! The upgraded DVM is functional.");
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
