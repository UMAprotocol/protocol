const hre = require("hardhat");

import { DesignatedVotingV2FactoryEthers } from "@uma/contracts-node";
import { getContractInstance } from "../../utils/contracts";

const { getContractFactory } = hre.ethers;

async function main() {
  console.log("Running DesignatedVotingV2 deployments🔥");

  const networkId = Number(await hre.getChainId());
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
