const hre = require("hardhat");

const { formatEther, parseEther } = hre.ethers.utils;

import { interfaceName } from "@uma/common";
import { FinderEthers, StoreEthers, VotingTokenEthers, VotingV2Ethers } from "@uma/contracts-node";

import { FOUNDATION_WALLET, getContractInstance } from "../../utils/contracts";
import { isVotingV2Instance } from "./migrationUtils";

async function main() {
  console.log("Running Voting Simulation🎭");

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
  const finalFee = (await store.computeFinalFee(votingToken.address)).rawValue;

  let foundationBalance = await votingToken.balanceOf(FOUNDATION_WALLET);
  console.log(` Foundation has ${formatEther(foundationBalance)} UMA, funding requester and voters...`);

  // There will be 3 voters with balances 0.6, 0.55 and 0.5 relative to GAT (total 1.65 * GAT), and for two price
  // price requests 4 * finalFee amount will be needed.
  if (foundationBalance.lt(gat.mul(parseEther("1.65")).div(parseEther("1")).add(finalFee.mul(4))))
    throw new Error("Foundation balance too low for simulation!");

  const foundationSigner = await hre.ethers.getSigner(FOUNDATION_WALLET);
  const [requesterSigner, voter1Signer, voter2Signer, voter3Signer] = await hre.ethers.getSigners();

  await votingToken.connect(foundationSigner).transfer(requesterSigner.address, finalFee.mul(4));
  await votingToken
    .connect(foundationSigner)
    .transfer(voter1Signer.address, gat.mul(parseEther("0.6")).div(parseEther("1")));
  await votingToken
    .connect(foundationSigner)
    .transfer(voter2Signer.address, gat.mul(parseEther("0.55")).div(parseEther("1")));
  await votingToken
    .connect(foundationSigner)
    .transfer(voter3Signer.address, gat.mul(parseEther("0.5")).div(parseEther("1")));

  const [requesterBalance, voter1Balance, voter2Balance, voter3Balance] = await Promise.all(
    [requesterSigner, voter1Signer, voter2Signer, voter3Signer].map((signer) => {
      return votingToken.balanceOf(signer.address);
    })
  );

  console.log(`  Requester now has ${formatEther(requesterBalance)} UMA.`);
  console.log(`  Voter 1 now has ${formatEther(voter1Balance)} UMA.`);
  console.log(`  Voter 2 now has ${formatEther(voter2Balance)} UMA.`);
  console.log(`  Voter 3 now has ${formatEther(voter3Balance)} UMA.`);

  console.log(" Returning all UMA to the foundation...");
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
  console.log(` Foundation has ${formatEther(foundationBalance)} UMA.`);
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
