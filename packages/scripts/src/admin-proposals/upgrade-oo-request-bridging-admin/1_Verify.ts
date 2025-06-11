// This script verifies the governance payload on Oracle bridging contracts upgrade has been properly executed.
// Export following environment variables:
// - NODE_URL_X: Child chain ID specific node URL (not required when using localhost for a forked network).
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging-admin/1_Verify.ts --network <network>
// Note: use localhost for the forked network, for public network also need to export the chain ID specific NODE_URL_X
// environment variable.

import { strict as assert } from "assert";
import { FinderEthers, getAddress, OptimisticOracleV3Ethers } from "@uma/contracts-node";
import { interfaceName } from "@uma/common";
import { utils as ethersUtils } from "ethers";
import { getContractInstance } from "../../utils/contracts";
import { AdminChildMessenger } from "@uma/contracts-node/typechain/core/ethers";

async function verifyChildMessenger(chainId: number) {
  const oracleSpokeAddress = await getAddress("OracleSpoke", chainId);
  const adminChildMessenger = await getContractInstance<AdminChildMessenger>(
    "Admin_ChildMessenger",
    undefined,
    chainId
  );
  assert((await adminChildMessenger.oracleSpoke()) === oracleSpokeAddress);
  console.log(
    ` ✅ OracleSpoke ${oracleSpokeAddress} is set in the admin child messenger ${adminChildMessenger.address} on chainId ${chainId}`
  );
}

async function verifyOracleImplementation(chainId: number) {
  const oracleSpokeAddress = await getAddress("OracleSpoke", chainId);
  const finder = await getContractInstance<FinderEthers>("Finder", undefined, chainId);
  assert(
    (await finder.getImplementationAddress(ethersUtils.formatBytes32String(interfaceName.Oracle))) ===
      oracleSpokeAddress
  );
  console.log(` ✅ OracleSpoke ${oracleSpokeAddress} is set as Oracle in the Finder on chainId ${chainId}`);
}

async function verifyCachedOracle(chainId: number) {
  const oracleSpokeAddress = await getAddress("OracleSpoke", chainId);
  const optimisticOracleV3 = await getContractInstance<OptimisticOracleV3Ethers>(
    "OptimisticOracleV3",
    undefined,
    chainId
  );
  assert((await optimisticOracleV3.cachedOracle()) === oracleSpokeAddress);
  console.log(
    ` ✅ OracleSpoke ${oracleSpokeAddress} is cached as Oracle in the OptimisticOracleV3 on chainId ${chainId}`
  );
}

async function main() {
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;

  console.log(" 1. Validating OracleSpoke address is set in the admin child messenger");
  await verifyChildMessenger(chainId);

  console.log(" 2. Validating OracleSpoke address is set as Oracle in the child chain Finder contract");
  await verifyOracleImplementation(chainId);

  console.log(" 3. Validating OracleSpoke address is cached as Oracle in the child chain OptimisticOracleV3 contract");
  await verifyCachedOracle(chainId);
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
