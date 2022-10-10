const hre = require("hardhat");
const assert = require("assert").strict;

const { formatBytes32String, formatEther, keccak256, parseEther, toUtf8Bytes } = hre.ethers.utils;
const abiCoder = new hre.ethers.utils.AbiCoder();

import { interfaceName } from "@uma/common";
import {
  FinderEthers,
  OptimisticOracleV2Ethers,
  StoreEthers,
  VotingTokenEthers,
  VotingV2Ethers,
} from "@uma/contracts-node";

import { FOUNDATION_WALLET, getContractInstance } from "../../utils/contracts";
import { increaseEvmTime } from "../../utils/utils";
import { isVotingV2Instance } from "./migrationUtils";

// Initial voter balances relative to GAT.
const voter1RelativeGatFunding = parseEther("0.6");
const voter2RelativeGatFunding = parseEther("0.55");
const voter3RelativeGatFunding = parseEther("0.5");

// Tested price identifier should be whitelisted.
const priceIdentifier = formatBytes32String("YES_OR_NO_QUERY");

async function main() {
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

  const foundationSigner = await hre.ethers.getSigner(FOUNDATION_WALLET);
  const [requesterSigner, voter1Signer, voter2Signer, voter3Signer] = await hre.ethers.getSigners();

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
  const firstRequestTimestamp = await votingV2.getCurrentTime();
  console.log(`✅ Time traveled to ${new Date(Number(firstRequestTimestamp.mul(1000))).toUTCString()}.`);

  console.log(" 4. Adding the first data request...");
  const firstOOAncillaryData = toUtf8Bytes("Really hard question.");
  await (
    await optimisticOracleV2
      .connect(requesterSigner)
      .requestPrice(priceIdentifier, firstRequestTimestamp, firstOOAncillaryData, votingToken.address, 0)
  ).wait();
  console.log("✅ Submitted data request to Optimistic Oracle.");
  await (await votingToken.connect(requesterSigner).approve(optimisticOracleV2.address, finalFee.mul(4))).wait();
  console.log("✅ Approved proposal & dispute bonds.");
  await (
    await optimisticOracleV2
      .connect(requesterSigner)
      .proposePrice(requesterSigner.address, priceIdentifier, firstRequestTimestamp, firstOOAncillaryData, 100)
  ).wait();
  console.log("✅ Proposed price to Optimistic Oracle.");
  await (
    await optimisticOracleV2
      .connect(requesterSigner)
      .disputePrice(requesterSigner.address, priceIdentifier, firstRequestTimestamp, firstOOAncillaryData)
  ).wait();
  console.log("✅ Disputed price to Optimistic Oracle.");
  const firstVotingAncillaryData = await optimisticOracleV2.stampAncillaryData(
    firstOOAncillaryData,
    requesterSigner.address
  );
  const firstRequestId = keccak256(
    abiCoder.encode(["bytes32", "uint256", "bytes"], [priceIdentifier, firstRequestTimestamp, firstVotingAncillaryData])
  );
  const firstPriceRequest = await votingV2.priceRequests(firstRequestId);
  assert.equal(firstPriceRequest.identifier, priceIdentifier);
  assert.equal(firstPriceRequest.time.toString(), firstRequestTimestamp.toString());
  assert.equal(firstPriceRequest.ancillaryData, firstVotingAncillaryData);
  console.log(`✅ Verified the first data request submitted for voting, id ${firstRequestId}`);

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
