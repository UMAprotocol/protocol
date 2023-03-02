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
  const claimData = [];

  for (const [index, designatedVotingContact] of designatedVotingData.entries()) {
    console.log("\n" + index, "-> fetching claim payload for", designatedVotingContact.designatedVoting);
    const claimPayload = await fetchClaimPayload(designatedVotingContact.designatedVoting);

    if (claimPayload.totalRewards != "0") {
      console.log("\t- Account has rewards to claim! Account has", claimPayload.multicallPayload.length, "rounds");
      claimData.push(claimPayload.multicallPayload);
    } else console.log("\t - Account has no rewards to claim. Skipping");
  }

  // Step 3 join elements to form one flattened array. This is the payload that will be sent to the multicall.
  const flattenedClaimPayload = claimData.flat();

  if (flattenedClaimPayload.length == 0) return;

  const shouldClaim = await yesno({
    question:
      `Found a total of ${flattenedClaimPayload.length} DesignatedVoting contracts with rewards to claim. ` +
      `Do you want to claim these rewards? (y/n)`,
  });

  if (!shouldClaim) process.exit(1);
  console.log(`Sending ClaimTx to VotingV2 multicall...`);
  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2");
  const tx = await votingV2.multicall(flattenedClaimPayload);
  tx.wait();
  console.log(`tx: https://etherscan.io/tx/${tx.hash}`);
}

async function fetchClaimPayload(address: string) {
  const response = await fetch(`http://vote.uma.xyz/api/past-rewards`, {
    method: "POST",
    body: JSON.stringify({ chainId: 1, address }),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    timeout: 30000,
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
