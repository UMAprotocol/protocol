// This script verify that the upgrade was executed correctly. It can be
// run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to execute the upgrade
// transactions. To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core:
// OPTIMISTC_ORACLE_V2=<OPTIMISTC-ORACLE-V2-ADDRESS> yarn hardhat run ./src/upgrade-tests/162/3_Verify.ts --network localhost

const hre = require("hardhat");

const assert = require("assert").strict;

const { RegistryRolesEnum, interfaceName } = require("@uma/common");
const { getAddress } = require("@uma/contracts-node");

import { Finder, Governor, Registry } from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../../utils/contracts";

const OPTIMISTIC_ORACLE_V2 = "OptimisticOracleV2"; // TODO use interfaceName.OptimisticOracle
const deployed_optimistic_oracle_address = process.env["OPTIMISTC_ORACLE_V2"];

async function main() {
  if (!deployed_optimistic_oracle_address) throw new Error("OPTIMISTC_ORACLE_V2 environment variable not set");
  const networkId = await hre.getChainId();
  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const registry = await getContractInstance<Registry>("Registry");

  console.log("Verifying that Governor doesn't hold the creator role...");
  !(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governor.address));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV2 is registered with the Registry...");
  assert(await registry.isContractRegistered(deployed_optimistic_oracle_address));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV2 is registered with the Finder...");
  assert.equal(
    (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2))).toLowerCase(),
    deployed_optimistic_oracle_address.toLowerCase()
  );
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV1 is still registered with the Registry...");
  assert(await registry.isContractRegistered(await getAddress(interfaceName.OptimisticOracle, Number(networkId))));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV1 is still registered with the Finder...");
  assert.equal(
    (
      await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(interfaceName.OptimisticOracle))
    ).toLowerCase(),
    await getAddress(interfaceName.OptimisticOracle, Number(networkId))
  );
  console.log("Verified!");

  console.log("Upgrade Verified!");
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
