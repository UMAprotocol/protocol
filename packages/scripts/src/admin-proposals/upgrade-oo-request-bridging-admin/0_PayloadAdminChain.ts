// This script creates a safe payload to be executed on a multisig controlled child messenger for the Oracle bridging
// contracts upgrade. Make sure that the newly deployed bridging contracts have been added to the networks config in the
// `core` package and the `contracts-node` package has been rebuilt. This will also impersonate the multisig owners and
// execute the safe payload on a forked network.
// Export following environment variables:
// - NODE_URL_X: Child chain ID specific node URL (not required when using localhost for a forked network).
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging-admin/0_PayloadAdminChain.ts --network <network>
// Note: use localhost for the forked network, for public network also need to export the chain ID specific NODE_URL_X
// environment variable.

import { FinderEthers, getAbi, getAddress, OptimisticOracleV3Ethers } from "@uma/contracts-node";
import { interfaceName } from "@uma/common";
import { AdminChildMessenger } from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers";
import { utils as ethersUtils, constants as ethersConstants, BytesLike } from "ethers";
import fs from "fs";
import path from "path";
import hre from "hardhat";
import { getContractInstance } from "../../utils/contracts";
import {
  appendTxToSafePayload,
  baseSafePayload,
  getContractMethod,
  simulateSafePayload,
} from "../../utils/gnosisPayload";

async function main() {
  const chainId = (await hre.ethers.provider.getNetwork()).chainId;
  const oracleSpokeAddress = await getAddress("OracleSpoke", chainId);
  const governorSpokeAddress = await getAddress("GovernorSpoke", chainId);
  const adminChildMessenger = await getContractInstance<AdminChildMessenger>(
    "Admin_ChildMessenger",
    undefined,
    chainId
  );
  const adminChildMessengerAbi = getAbi("Admin_ChildMessenger");
  const finder = await getContractInstance<FinderEthers>("Finder", undefined, chainId);
  const optimisticOracleV3 = await getContractInstance<OptimisticOracleV3Ethers>(
    "OptimisticOracleV3",
    undefined,
    chainId
  );

  // Will construct the safe payload for the multisig owners to execute.
  const multisig = await adminChildMessenger.owner();

  // Update the OracleSpoke address in the AdminChildMessenger
  let safePayload = baseSafePayload(chainId, "", "", multisig);
  safePayload = appendTxToSafePayload(
    safePayload,
    adminChildMessenger.address,
    getContractMethod(adminChildMessengerAbi, "setOracleSpoke"),
    {
      newOracleSpoke: oracleSpokeAddress,
    }
  );

  // Set OracleSpoke as Oracle in L2 Finder and sync the cached value in OptimisticOracleV3 atomically
  const relayedTransactions: {
    to: string;
    data: BytesLike;
  }[] = [];
  const changeImplementationAddressTx = await finder.populateTransaction.changeImplementationAddress(
    ethersUtils.formatBytes32String(interfaceName.Oracle),
    oracleSpokeAddress
  );
  if (!changeImplementationAddressTx.data) throw new Error("changeImplementationAddressTx.data is empty");
  relayedTransactions.push({ to: finder.address, data: changeImplementationAddressTx.data });
  const syncUmaParamsTx = await optimisticOracleV3.populateTransaction.syncUmaParams(
    ethersUtils.formatBytes32String(""),
    ethersConstants.AddressZero
  );
  if (!syncUmaParamsTx.data) throw new Error("syncUmaParamsTx.data is empty");
  relayedTransactions.push({ to: optimisticOracleV3.address, data: syncUmaParamsTx.data });
  const encodedCalls = ethersUtils.defaultAbiCoder.encode(["tuple(address to, bytes data)[]"], [relayedTransactions]);
  safePayload = appendTxToSafePayload(
    safePayload,
    adminChildMessenger.address,
    getContractMethod(adminChildMessengerAbi, "processMessageFromCrossChainParent"),
    {
      data: encodedCalls,
      target: governorSpokeAddress,
    }
  );

  const outDir = path.resolve(__dirname, "../../../out"); // root of the scripts package, must check when moving the script
  fs.mkdirSync(outDir, { recursive: true });
  const savePath = path.join(outDir, `${path.basename(__dirname)}_${chainId}.json`);
  fs.writeFileSync(savePath, JSON.stringify(safePayload, null, 4));

  console.log(`Safe payload for ${multisig} saved to ${savePath}`);

  // Only spoof the execution on a forked network.
  if (hre.network.name === "localhost") {
    // The version only impacts which MultiSendCallOnly contract is called as the used safe interfaces for the
    // simulation are the same across the versions.
    const safeVersion = "1.3.0";
    await simulateSafePayload(hre.ethers.provider, safePayload, safeVersion);
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
