// This script verify that the upgrade was executed correctly.
// yarn hardhat run ./src/upgrade-tests/sherlock-update/2_Verify.ts --network localhost

import { strict as assert } from "assert";

import { IdentifierWhitelistEthers } from "@uma/contracts-node";
import { formatBytes32String } from "ethers/lib/utils";
import { getContractInstance } from "../../utils/contracts";

const sherlockIdentifier = formatBytes32String("SHERLOCK_CLAIM");

async function main() {
  const identifierWhitelist = await getContractInstance<IdentifierWhitelistEthers>("IdentifierWhitelist");

  console.log(" 1. Validating Sherlock identifier is supported");
  assert(await identifierWhitelist.isIdentifierSupported(sherlockIdentifier));
  console.log("✅ Sherlock identifier is supported");
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
