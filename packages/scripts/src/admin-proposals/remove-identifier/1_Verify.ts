// This script can be run against a public or forked networks.
// Export following environment variables:
// - NODE_URL_1: Mainnet node URL (not required when using localhost for a forked network).
// - NODE_URL_137: Public or forked Polygon node URL.
// - NODE_URL_10: Public or forked Optimism node URL.
// - NODE_URL_42161: Public or forked Arbitrum node URL.
// - NODE_URL_8453: Public or forked Base node URL.
// - NODE_URL_81457: Public or forked Blast node URL.
// - IDENTIFIER: Identifier to remove.
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/remove-identifier/1_Verify.ts --network <network>
// Note: use localhost for the forked network, for L1 mainnet need to export NODE_URL_1 environment variable.

import { strict as assert } from "assert";
import hre from "hardhat";
import { IdentifierWhitelistEthers } from "@uma/contracts-node";
import { formatBytes32String } from "ethers/lib/utils";
import { getContractInstanceWithProvider } from "../../utils/contracts";
import { getJsonRpcProvider, supportedNetworks } from "../common";

async function main() {
  if (!process.env.IDENTIFIER) throw new Error("IDENTIFIER is not set");
  const oldIdentifier = formatBytes32String(process.env.IDENTIFIER);

  for (const networkName of supportedNetworks) {
    const provider = networkName === "mainnet" ? hre.ethers.provider : await getJsonRpcProvider(networkName);
    const identifierWhitelist = await getContractInstanceWithProvider<IdentifierWhitelistEthers>(
      "IdentifierWhitelist",
      provider
    );

    console.log(
      `Validating identifier ${process.env.IDENTIFIER} on ${networkName} at IdentifierWhitelist address: ${identifierWhitelist.address}`
    );
    assert(!(await identifierWhitelist.isIdentifierSupported(oldIdentifier)));
    console.log(`✅ ${process.env.IDENTIFIER} identifier is not supported on ${networkName}`);
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
