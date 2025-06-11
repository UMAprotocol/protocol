// This script verifies the governance vote on Oracle bridging contracts upgrade has been properly executed.
// Export following environment variables:
// - NODE_URL_1: Ethereum mainnet or its fork node URL.
// - NODE_URL_137: Polygon or its fork node URL.
// - NODE_URL_10: Optimism or its fork node URL.
// - NODE_URL_42161: Arbitrum or its fork node URL.
// - NODE_URL_8453: Base or its fork node URL.
// - NODE_URL_81457: Blast or its fork node URL.
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/4_Verify.ts --network <network>
// Note: use localhost for the forked L1, for L1 mainnet need to export NODE_URL_1 environment variable.

import { strict as assert } from "assert";
import { RegistryRolesEnum, interfaceName } from "@uma/common";
import {
  FinderEthers,
  getAddress,
  OptimisticOracleV3Ethers,
  OracleChildTunnelEthers,
  OracleRootTunnelEthers,
  RegistryEthers,
} from "@uma/contracts-node";
import { utils as ethersUtils } from "ethers";
import {
  getChildMessenger,
  getJsonRpcProvider,
  getParentMessenger,
  L2Network,
  l2Networks,
  networksNumber,
  RollupNetwork,
  rollupNetworks,
} from "../common";
import { getContractInstance, getContractInstanceWithProvider } from "../../utils/contracts";

async function verifyRegistry() {
  const oracleRootTunnelAddress = await getAddress("OracleRootTunnel", networksNumber["mainnet"]);
  const registry = await getContractInstance<RegistryEthers>("Registry");
  assert(await registry.isContractRegistered(oracleRootTunnelAddress));
  console.log(` ✅ OracleRootTunnel ${oracleRootTunnelAddress} is registered`);
  const governorV2Address = await getAddress("GovernorV2", networksNumber["mainnet"]);
  assert(!(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governorV2Address)));
  console.log(` ✅ GovernorV2 ${governorV2Address} does not hold CONTRACT_CREATOR role`);
}

async function verifyParentMessenger(networkName: RollupNetwork) {
  const l2ChainId = networksNumber[networkName];
  const oracleSpokeAddress = await getAddress("OracleSpoke", l2ChainId);
  const parentMessenger = await getParentMessenger(networkName);
  console.log(
    ` - Validating OracleSpoke ${oracleSpokeAddress} is set in ${networkName} parent messenger ${parentMessenger.address}`
  );
  assert((await parentMessenger.oracleSpoke()) === oracleSpokeAddress);
  console.log(
    ` ✅ OracleSpoke ${oracleSpokeAddress} is set in ${networkName} parent messenger ${parentMessenger.address}`
  );
}

async function verifyChildMessenger(networkName: RollupNetwork) {
  const l2ChainId = networksNumber[networkName];
  const oracleSpokeAddress = await getAddress("OracleSpoke", l2ChainId);
  const childMessenger = await getChildMessenger(networkName);
  console.log(
    ` - Validating OracleSpoke ${oracleSpokeAddress} is set in ${networkName} child messenger ${childMessenger.address}`
  );
  assert((await childMessenger.oracleSpoke()) === oracleSpokeAddress);
  console.log(
    ` ✅ OracleSpoke ${oracleSpokeAddress} is set in ${networkName} child messenger ${childMessenger.address}`
  );
}

async function verifyOracleImplementation(networkName: L2Network) {
  const l2Provider = await getJsonRpcProvider(networkName);
  const l2ChainId = networksNumber[networkName];
  const childOracleAddress =
    networkName === "polygon"
      ? await getAddress("OracleChildTunnel", l2ChainId)
      : await getAddress("OracleSpoke", l2ChainId);
  const childOracleName = networkName === "polygon" ? "OracleChildTunnel" : "OracleSpoke";
  const finder = await getContractInstanceWithProvider<FinderEthers>("Finder", l2Provider);
  console.log(` - Validating ${childOracleName} ${childOracleAddress} is set as Oracle in ${networkName} Finder`);
  assert(
    (await finder.getImplementationAddress(ethersUtils.formatBytes32String(interfaceName.Oracle))) ===
      childOracleAddress
  );
  console.log(` ✅ ${childOracleName} ${childOracleAddress} is set as Oracle in ${networkName} Finder`);
}

async function verifyCachedOracle(networkName: L2Network) {
  const l2Provider = await getJsonRpcProvider(networkName);
  const l2ChainId = networksNumber[networkName];
  const childOracleAddress =
    networkName === "polygon"
      ? await getAddress("OracleChildTunnel", l2ChainId)
      : await getAddress("OracleSpoke", l2ChainId);
  const childOracleName = networkName === "polygon" ? "OracleChildTunnel" : "OracleSpoke";
  const optimisticOracleV3 = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>(
    "OptimisticOracleV3",
    l2Provider
  );
  console.log(
    ` - Validating ${childOracleName} ${childOracleAddress} is cached as Oracle in ${networkName} OptimisticOracleV3`
  );
  assert((await optimisticOracleV3.cachedOracle()) === childOracleAddress);
  console.log(` ✅ ${childOracleName} ${childOracleAddress} is cached as Oracle in ${networkName} OptimisticOracleV3`);
}

async function verifyOracleTunnels() {
  const polygonProvider = await getJsonRpcProvider("polygon");
  const oracleChildTunnel = await getContractInstanceWithProvider<OracleChildTunnelEthers>(
    "OracleChildTunnel",
    polygonProvider
  );
  const oracleRootTunnel = await getContractInstance<OracleRootTunnelEthers>("OracleRootTunnel");
  console.log(
    ` - Validating OracleChildTunnel ${oracleChildTunnel.address} is set in OracleRootTunnel ${oracleRootTunnel.address}`
  );
  assert((await oracleRootTunnel.fxChildTunnel()) === oracleChildTunnel.address);
  console.log(
    ` ✅ OracleChildTunnel ${oracleChildTunnel.address} is set in OracleRootTunnel ${oracleRootTunnel.address}`
  );
  console.log(
    ` - Validating OracleRootTunnel ${oracleRootTunnel.address} is set in OracleChildTunnel ${oracleChildTunnel.address}`
  );
  assert((await oracleChildTunnel.fxRootTunnel()) === oracleRootTunnel.address);
  console.log(
    ` ✅ OracleRootTunnel ${oracleRootTunnel.address} is set in OracleChildTunnel ${oracleChildTunnel.address}`
  );
}

async function main() {
  // Checks node URL for each L2 network is set.
  l2Networks.forEach(getJsonRpcProvider);

  console.log(` 1. Validating OracleRootTunnel is registered`);
  await verifyRegistry();

  console.log(" 2. Validating OracleSpoke addresses are set in parent messengers");
  for (const networkName of rollupNetworks) {
    await verifyParentMessenger(networkName);
  }

  console.log(" 3. Validating OracleSpoke addresses are set in child messengers");
  for (const networkName of rollupNetworks) {
    await verifyChildMessenger(networkName);
  }

  console.log(" 4. Validating child oracle addresses are set as Oracle in L2 Finder contracts");
  for (const networkName of l2Networks) {
    await verifyOracleImplementation(networkName);
  }

  console.log(" 5. Validating OracleSpoke addresses are cached as Oracle in L2 OptimisticOracleV3 contracts");
  for (const networkName of l2Networks) {
    await verifyCachedOracle(networkName);
  }

  console.log(" 6. Validating oracle tunnel addresses are set correctly");
  await verifyOracleTunnels();
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
