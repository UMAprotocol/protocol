// This script verify that the indentifier has been whitelisted in the IdentifierWhitelist contract in mainnet.
// IDENTIFIER=<IDENTIFIER-TO-ADD> \
// yarn hardhat run packages/scripts/src/admin-proposals/add-identifier/1_Verify.ts --network localhost

import { strict as assert } from "assert";

import { IdentifierWhitelistEthers } from "@uma/contracts-node";
import { formatBytes32String } from "ethers/lib/utils";
import { getContractInstance } from "../../utils/contracts";

async function main() {
  const identifierWhitelist = await getContractInstance<IdentifierWhitelistEthers>("IdentifierWhitelist");

  if (!process.env.IDENTIFIER) throw new Error("IDENTIFIER is not set");
  const newIdentifier = formatBytes32String(process.env.IDENTIFIER);

  console.log(` 1. Validating identifier ${process.env.IDENTIFIER} is supported`);
  assert(await identifierWhitelist.isIdentifierSupported(newIdentifier));
  console.log(`✅ ${process.env.IDENTIFIER} identifier is supported`);
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
