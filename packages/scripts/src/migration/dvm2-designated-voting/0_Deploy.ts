import hre from "hardhat";
import { utils } from "ethers";
import yesno from "yesno";

import { DesignatedVotingV2FactoryEthers } from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";

import { getDesignatedVotingContractsOwnedByOwner } from "./common";

async function main() {
  console.log("Running DesignatedVotingV2 deployments🔥");

  // const networkId = Number(await hre.getChainId());
  // if (networkId != 1) throw new Error("Can only run on mainnet");
  if (!process.env.ETHERSCAN_API_KEY) throw new Error("No ETHERSCAN_API_KEY");
  if (!process.env.OWNER_TO_MIGRATE) throw new Error("No OWNER_TO_MIGRATE set");
  const owner = process.env.OWNER_TO_MIGRATE || "";

  // Fetch all current DesignatedVoting contracts owned by the owner. Remove elements that have 0 balance.
  const designatedVotingData = (await getDesignatedVotingContractsOwnedByOwner(owner)).filter((e) => e.balance.gt(0));

  // Log all designated voting and the associated hot wallets. remove the owner element from the object to keep it short.
  console.log(`Found the following DesignatedVoting to migrate owned by ${owner}:`);
  console.table(
    designatedVotingData.map((e: { designatedVoting: string; owner?: string; hotWallet: string; balance: any }) => {
      delete e.owner;
      const umaBalance = utils.formatEther(e.balance);
      e.balance = umaBalance.substring(0, umaBalance.indexOf("."));
      return e;
    })
  );

  // Construct payload to deploy new DesignatedVotingV2 contracts for each hot wallet.
  const factoryV2 = await getContractInstance<DesignatedVotingV2FactoryEthers>(
    "DesignatedVotingV2Factory",
    "0xAe9Ed85dE2670e3112590a2BB17b7283ddF44d9c"
  );
  const multiCallPayload = designatedVotingData.map((data) =>
    factoryV2.interface.encodeFunctionData("newDesignatedVoting", [owner, data.hotWallet])
  );

  console.log("multiCallPayload", multiCallPayload);

  const shouldDeploy = await yesno({
    question: `Constructed multicall payload. Are you ready to deploy? Will crease ${[0].length} contracts. y/n`,
  });

  if (!shouldDeploy) process.exit(0);

  // Deploy all the contracts.
  console.log("Deploying contracts...");
  const tx = await factoryV2.multicall(multiCallPayload);
  tx.wait();
  console.log("tx", tx.hash);
  console.log("tx", tx);

  // console.log("multiCallPayload", multiCallPayload);
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
