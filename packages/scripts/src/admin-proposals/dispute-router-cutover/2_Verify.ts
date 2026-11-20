// This script verifies the DisputeRouter cutover proposal has been properly executed on Polygon.
// Export following environment variables:
// - NODE_URL_137: Polygon or its fork node URL.
// - ROUTER_ADDRESS: (optional) DisputeRouter proxy address on Polygon, defaults to the deployed proxy.
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/dispute-router-cutover/2_Verify.ts --network <network>

import { strict as assert } from "assert";
import { interfaceName, RegistryRolesEnum } from "@uma/common";
import { FinderEthers, getAddress, OptimisticOracleV3Ethers, RegistryEthers } from "@uma/contracts-node";
import { utils as ethersUtils } from "ethers";
import { getJsonRpcProvider, networksNumber } from "../common";
import { getContractInstanceWithProvider } from "../../utils/contracts";
import { getRouterAddress } from "./common";

async function main() {
  const routerAddress = getRouterAddress();

  const provider = getJsonRpcProvider("polygon");
  const finder = await getContractInstanceWithProvider<FinderEthers>("Finder", provider);
  const registry = await getContractInstanceWithProvider<RegistryEthers>("Registry", provider);
  const optimisticOracleV3 = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>(
    "OptimisticOracleV3",
    provider
  );
  const governorChildTunnelAddress = await getAddress("GovernorChildTunnel", networksNumber["polygon"]);

  assert.equal(
    await finder.getImplementationAddress(ethersUtils.formatBytes32String(interfaceName.Oracle)),
    routerAddress
  );
  console.log(` ✅ DisputeRouter ${routerAddress} is set as Oracle in Polygon Finder ${finder.address}`);

  assert(await registry.isContractRegistered(routerAddress));
  console.log(` ✅ DisputeRouter ${routerAddress} is registered in Polygon Registry ${registry.address}`);

  assert(!(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governorChildTunnelAddress)));
  console.log(` ✅ GovernorChildTunnel ${governorChildTunnelAddress} does not hold CONTRACT_CREATOR role`);

  assert.equal(await optimisticOracleV3.cachedOracle(), routerAddress);
  console.log(
    ` ✅ DisputeRouter ${routerAddress} is cached as Oracle in OptimisticOracleV3 ${optimisticOracleV3.address}`
  );
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
