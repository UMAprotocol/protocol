// This script verify that the upgrade was executed correctly.
// yarn hardhat run ./src/upgrade-tests/across-v3-update/2_Verify.ts --network localhost

import { strict as assert } from "assert";

import { IdentifierWhitelistEthers } from "@uma/contracts-node";
import { formatBytes32String } from "ethers/lib/utils";
import { getContractInstance } from "../../utils/contracts";

const acrossIdentifier = formatBytes32String("ACROSS-V2");

async function main() {
  const identifierWhitelist = await getContractInstance<IdentifierWhitelistEthers>("IdentifierWhitelist");

  console.log(" 1. Validating Across identifier is supported");
  assert(await identifierWhitelist.isIdentifierSupported(acrossIdentifier));
  console.log("✅ Across identifier is supported");
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
