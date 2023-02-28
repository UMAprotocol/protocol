// This script is second step in the migration and should be done AFTER the execution of the upgrade payload but before
// the execution of the token migrations. It is used to claim all outstanding rewards for all Designated voting token
// recipient on the behalf of these users as, otherwise, their tokens would be left over after the migration.

const hre = require("hardhat");
import yesno from "yesno";
import fetch from "node-fetch";
import { VotingV2Ethers } from "@uma/contracts-node";
import { getDesignatedVotingContractsOwnedByOwner } from "./common";
import { getContractInstance } from "../../utils/contracts";

async function main() {
  console.log("Running Claim rewards for designated voting contracts 👷‍♀️");
  const chainId = Number(await hre.getChainId());
  if (chainId != 1) throw new Error("Can only run on mainnet");

  if (!process.env.OWNER_TO_MIGRATE) throw new Error("No OWNER_TO_MIGRATE set");
  const owner = process.env.OWNER_TO_MIGRATE || "";

  // Step 1: fetch all old designated voting contracts.
  const designatedVotingData = (await getDesignatedVotingContractsOwnedByOwner(owner)).filter((e) => e.balance.gt(0));

  // Step 2: for each contract see if there is a past reward to claim.
  console.log("ADR");
  designatedVotingData.map((data) => console.log(data.designatedVoting));

  const claimData = await (
    await Promise.all(designatedVotingData.map((data) => fetchClaimPayload(data.designatedVoting)))
  ).filter((data) => data.totalRewards != "0");

  console.log("claimData", claimData);

  const shouldClaim = await yesno({
    question:
      `Found a total of ${claimData.length} DesignatedVoting contracts with rewards to claim.` +
      `Do you want to claim these rewards? (y/n)`,
  });

  if (!shouldClaim) process.exit(1);
  console.log(`Sending ClaimTx to VotingV2 multicall...`);
  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2");
  const tx = await votingV2.multicall(claimData);
  tx.wait();
  console.log(`tx: https://etherscan.io/tx/${tx.hash}`);
}

async function fetchClaimPayload(address: string) {
  const response = await fetch(`https://voter-dapp-v2-seven.vercel.app/api/past-rewards`, {
    method: "POST",
    body: JSON.stringify({ chainId: 1, address }),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
  });
  return await response.json();
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
