const hre = require("hardhat");
import { utils } from "ethers";
import yesno from "yesno";

import { DesignatedVotingV2FactoryEthers } from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";

import { getDesignatedVotingContractsOwnedByOwner } from "./common";

async function main() {
  const networkId = Number(await hre.getChainId());
  console.log("Running DesignatedVotingV2 deployments🔥\nChainId:", networkId);

  if (networkId != 1) throw new Error("Can only run on mainnet");
  if (!process.env.OWNER_TO_MIGRATE) throw new Error("No OWNER_TO_MIGRATE set");
  const owner = process.env.OWNER_TO_MIGRATE || "";
  const maxDesignatedVotingDeployedPerBatch = Number(process.env.MAX_CONTRACTS_PER_BATCH) || 5;

  // Replace hot wallets based on provided env variable.
  // Note: the env variable should be formatted as follows:
  // HOT_WALLET_REPLACEMENTS="0x1234:0x5678,0x9abc:0xdef0"
  const replacementPairs = process.env.HOT_WALLET_REPLACEMENTS?.split(",") || [];
  const oldToNewWallet = Object.fromEntries(
    replacementPairs.map((replacementPair) => {
      // Split by ":".
      const [originalWallet, replacementWallet] = replacementPair.split(":");
      if (!originalWallet || !replacementWallet) throw new Error("Invalid HOT_WALLET_REPLACEMENTS provided");
      // Ensure that the addresses are formatted consistently.
      return [utils.getAddress(originalWallet), utils.getAddress(replacementWallet)];
    })
  );

  if (Object.keys(oldToNewWallet).length > 0) {
    console.log("Replacing the following hot wallets:");
    console.table(
      Object.entries(oldToNewWallet).map(([originalWallet, replacementWallet]) => ({
        originalWallet,
        replacementWallet,
      }))
    );
  }

  // Fetch all current DesignatedVoting contracts owned by the owner. Remove elements that have 0 balance.
  const designatedVotingData = (await getDesignatedVotingContractsOwnedByOwner(owner)).filter((e) => e.balance.gt(0));

  // Log all designated voting and the associated hot wallets. remove the owner element from the object to keep it short.
  console.log(`Found the following DesignatedVoting to migrate owned by ${owner}:`);
  const loggedObject = JSON.parse(JSON.stringify(designatedVotingData));
  console.table(
    loggedObject.map((e: any) => {
      delete e.owner;
      const umaBalance = utils.formatEther(e.balance);
      e.balance = umaBalance.substring(0, umaBalance.indexOf("."));
      return e;
    })
  );

  // Construct payload to deploy new DesignatedVotingV2 contracts for each hot wallet.
  const factoryV2 = await getContractInstance<DesignatedVotingV2FactoryEthers>(
    "DesignatedVotingV2Factory",
    "0xa024501191bdff069329cbdd064e39dc2aa3af6c"
  );
  const numberOfPayloadsToBuild = Math.ceil(designatedVotingData.length / maxDesignatedVotingDeployedPerBatch);
  const multiCallPayloads: any[] = [];
  for (let i = 0; i < numberOfPayloadsToBuild; i++) {
    multiCallPayloads.push(
      designatedVotingData
        .slice(i * maxDesignatedVotingDeployedPerBatch, (i + 1) * maxDesignatedVotingDeployedPerBatch)
        .map((data) =>
          factoryV2.interface.encodeFunctionData("newDesignatedVoting", [
            owner,
            // Replace with the replacement wallet if it exists.
            oldToNewWallet[utils.getAddress(data.voter)] || data.voter,
          ])
        )
    );
  }

  const shouldDeploy = await yesno({
    question:
      `Constructed multicall payloads to deploy ${designatedVotingData.length} contracts. ` +
      `Are you ready to deploy? This Will send ${numberOfPayloadsToBuild} separate transactions,` +
      ` each deploying up to ${maxDesignatedVotingDeployedPerBatch} designated voting contracts.`,
  });

  if (!shouldDeploy) process.exit(0);

  // Deploy all the contracts.
  console.log("Deploying contracts...");

  for (let i = 0; i < numberOfPayloadsToBuild; i++) {
    console.log(`Sending bundle ${i} to deploy ${multiCallPayloads[i].length} DesignatedVotingV2 Contracts...`);
    const tx = await factoryV2.multicall(multiCallPayloads[i]);
    tx.wait();
    console.log(`tx: https://etherscan.io/tx/${tx.hash}`);
  }
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
