// This script verifies that the GAT and SPAT have been correctly configured in mainnet.
// It can be run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to verify.
// To run this on the localhost first fork mainnet into a local hardhat node by running:
// NODE_URL_1=<MAINNET-NODE-URL> \
// GAT=<GAT> \ # e.g. 5000000
// SPAT=<SPAT> \ # e.g. 65
// yarn hardhat run packages/scripts/src/admin-proposals/set-gat-and-spat/1_Verify.ts --network localhost

import { VotingV2Ethers } from "@uma/contracts-node";
import { strict as assert } from "assert";
import hre from "hardhat";
import { getContractInstance } from "../../utils/contracts";
const { ethers } = hre;

function parseEnvVars() {
  const { GAT, SPAT } = process.env;
  assert(GAT && !isNaN(Number(GAT)), "Invalid or missing GAT"); // GAT in token units scaled by UMA VotingToken decimals
  assert(SPAT && !isNaN(Number(SPAT)), "Invalid or missing SPAT"); // SPAT as 65% → 0.65 * 1e18 (scaled with 16 decimals)

  // Validate GAT and SPAT.
  assert(!isNaN(Number(process.env.GAT)) && Number(process.env.GAT) > 0, "GAT must be a number greater than 0");
  assert(!isNaN(Number(process.env.SPAT)) && Number(process.env.SPAT) > 0, "SPAT must be a number greater than 0");
  assert(Number(process.env.SPAT) < 100, "SPAT must be less than 100%");
  return {
    gat: ethers.utils.parseEther(GAT),
    spat: ethers.utils.parseUnits(SPAT, 16),
  };
}

async function main() {
  const { gat, spat } = parseEnvVars();
  const votingV2 = await getContractInstance<VotingV2Ethers>("VotingV2");

  console.log(`Verifying GAT = ${ethers.utils.formatEther(gat)} tokens`);
  console.log(`Verifying SPAT = ${ethers.utils.formatUnits(spat, 16)}%`);

  const onChainGat = await votingV2.gat();
  const onChainSpat = await votingV2.spat();
  assert(onChainGat.eq(gat), `GAT mismatch: expected ${gat}, got ${onChainGat}`);
  assert(onChainSpat.eq(spat), `SPAT mismatch: expected ${spat}, got ${onChainSpat}`);
  console.log("Verified!");
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
