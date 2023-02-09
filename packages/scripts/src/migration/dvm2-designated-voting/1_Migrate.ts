import hre from "hardhat";

import { VotingTokenEthers, DesignatedVotingV2FactoryEthers, DesignatedVotingV2Ethers } from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";

import { getDesignatedVotingContractsOwnedByOwner } from "./common";

import { EventFilter } from "ethers";

async function main() {
  console.log("Running Migration Gnosis payload builder 👷‍♀️");
  const networkId = Number(await hre.getChainId());
  if (networkId != 1) throw new Error("Can only run on mainnet");
  if (!process.env.ETHERSCAN_API_KEY) throw new Error("No ETHERSCAN_API_KEY");
  if (!process.env.OWNER_TO_MIGRATE) throw new Error("No OWNER_TO_MIGRATE set");
  const owner = process.env.OWNER_TO_MIGRATE || "";

  // Step 1: fetch all current DesignatedVoting contracts owned by the owner.
  const designatedVotingData = await getDesignatedVotingContractsOwnedByOwner(owner);

  // Step 2: fetch all the deployed DesignatedVotingV2 contracts and append them to this datastructure.
  const factoryV2 = await getContractInstance<DesignatedVotingV2FactoryEthers>("DesignatedVotingV2Factory");

  const designatedVotingEvents = await factoryV2.queryFilter(factoryV2.filters.NewDesignatedVoting(null, null, owner));
  
  // For each designated voting contract, construct a gnosis payload to withdraw the tokens from the contract.
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
