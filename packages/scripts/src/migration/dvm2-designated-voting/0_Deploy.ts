// This script deploys DesignatedVotingV2 contracts for each hot wallet that is a delegate of the set owner. Used as the
// first step in a larger migration process.

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
  const factoryV2 = await getContractInstance<DesignatedVotingV2FactoryEthers>("DesignatedVotingV2Factory");
  const numberOfPayloadsToBuild = Math.ceil(designatedVotingData.length / maxDesignatedVotingDeployedPerBatch);
  const multiCallPayloads: any[] = [];
  for (let i = 0; i < numberOfPayloadsToBuild; i++) {
    multiCallPayloads.push(
      designatedVotingData
        .slice(i * maxDesignatedVotingDeployedPerBatch, (i + 1) * maxDesignatedVotingDeployedPerBatch)
        .map((data) => factoryV2.interface.encodeFunctionData("newDesignatedVoting", [owner, data.voter]))
    );
  }

  const shouldDeploy = await yesno({
    question:
      `Constructed multicall payloads to deploy ${designatedVotingData.length} contracts. ` +
      `Are you ready to deploy? This Will send ${numberOfPayloadsToBuild} separate transactions,` +
      ` each deploying up to ${maxDesignatedVotingDeployedPerBatch} designated voting contracts. (y/n)`,
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
