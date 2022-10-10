const hre = require("hardhat");

const { formatEther, parseEther } = hre.ethers.utils;

import { interfaceName } from "@uma/common";
import { FinderEthers, StoreEthers, VotingTokenEthers, VotingV2Ethers } from "@uma/contracts-node";

import { FOUNDATION_WALLET, getContractInstance } from "../../utils/contracts";
import { increaseEvmTime } from "../../utils/utils";
import { isVotingV2Instance } from "./migrationUtils";

// Initial voter balances relative to GAT.
const voter1RelativeGatFunding = parseEther("0.6");
const voter2RelativeGatFunding = parseEther("0.55");
const voter3RelativeGatFunding = parseEther("0.5");

async function main() {
  console.log("🎭 Running Voting Simulation after V2 upgrade");

  if (hre.network.name != "localhost") throw new Error("Voting should be only tested in simulation!");

  const finder = await getContractInstance<FinderEthers>("Finder");
  const store = await getContractInstance<StoreEthers>("Store");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const votingV2Address = await finder.getImplementationAddress(
    hre.ethers.utils.formatBytes32String(interfaceName.Oracle)
  );
  if (!(await isVotingV2Instance(votingV2Address))) throw new Error("Oracle is not VotingV2 instance!");

  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2", votingV2Address);

  const gat = await votingV2.gat();
  const unstakeCoolDown = await votingV2.unstakeCoolDown();
  const finalFee = (await store.computeFinalFee(votingToken.address)).rawValue;

  let foundationBalance = await votingToken.balanceOf(FOUNDATION_WALLET);
  console.log(` 1. Foundation has ${formatEther(foundationBalance)} UMA, funding requester and voters...`);

  // There will be 3 voters with initial balances set relative to GAT, and for two price
  // price requests 4 * finalFee amount will be needed.
  if (
    foundationBalance.lt(
      gat
        .mul(voter1RelativeGatFunding.add(voter2RelativeGatFunding.add(voter3RelativeGatFunding)))
        .div(parseEther("1"))
        .add(finalFee.mul(4))
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
    await votingToken.connect(foundationSigner).transfer(requesterSigner.address, finalFee.mul(4).sub(requesterBalance))
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

  console.log(" 2. Voters are approving UMA for staking...");
  await (await votingToken.connect(voter1Signer).approve(votingV2.address, voter1Balance)).wait();
  await (await votingToken.connect(voter2Signer).approve(votingV2.address, voter2Balance)).wait();
  await (await votingToken.connect(voter3Signer).approve(votingV2.address, voter3Balance)).wait();
  console.log("✅ Approvals on VotingV2 done!");

  console.log(" 3. Voters are staking all their UMA...");
  await (await votingV2.connect(voter1Signer).stake(voter1Balance)).wait();
  await (await votingV2.connect(voter2Signer).stake(voter2Balance)).wait();
  await (await votingV2.connect(voter3Signer).stake(voter3Balance)).wait();
  console.log("✅ Voters have staked all their UMA!");

  console.log(" 4. Requesting unstake...");
  await (await votingV2.connect(voter1Signer).requestUnstake(voter1Balance)).wait();
  await (await votingV2.connect(voter2Signer).requestUnstake(voter2Balance)).wait();
  await (await votingV2.connect(voter3Signer).requestUnstake(voter3Balance)).wait();
  console.log("✅ Voters requested unstake of all UMA!");

  console.log(" 5. Waiting for unstake cooldown...");
  await increaseEvmTime(unstakeCoolDown.toNumber());
  console.log(`✅ Unstake colldown of ${unstakeCoolDown.toNumber()} seconds has passed!`);

  console.log(" 6. Executing unstake");
  await (await votingV2.connect(voter1Signer).executeUnstake()).wait();
  await (await votingV2.connect(voter2Signer).executeUnstake()).wait();
  await (await votingV2.connect(voter3Signer).executeUnstake()).wait();
  console.log("✅ Voters have unstaked all UMA!");

  console.log(" 7. Returning all UMA to the foundation...");
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
