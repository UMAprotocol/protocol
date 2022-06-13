// This script verify that the upgrade was executed correctly. It can be
// run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to execute the upgrade
// transactions. To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core:
// yarn hardhat run ./test/optimistic-oracle-umip/3_Verify.ts --network mainnet-fork

const hre = require("hardhat");

const assert = require("assert").strict;

const { RegistryRolesEnum } = require("@uma/common");

import { Governor, Finder, Registry } from "@uma/core/contract-types/ethers";

const { getAddress } = require("@uma/contracts-node");

const OPTIMISTIC_ORACLE_V2 = "OptimisticOracleV2"; // TODO use interfaceName.OptimisticOracle
const deployed_optimistic_oracle_address = "0xA0Ae6609447e57a42c51B50EAe921D701823FFAe";

const getContractInstance = async <T>(contractName: string): Promise<T> => {
  const networkId = await hre.getChainId();
  const factory = await hre.ethers.getContractFactory(contractName);
  const contractAddress = await getAddress(contractName, Number(networkId));
  return (await factory.attach(contractAddress)) as T;
};

async function main() {
  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const registry = await getContractInstance<Registry>("Registry");

  console.log("Verifying that Governor doesn't hold the creator role...");
  !(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governor.address));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracle is registered with the Registry...");
  assert(await registry.isContractRegistered(deployed_optimistic_oracle_address));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV2 is registered with the Finder...");
  assert.equal(
    (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2))).toLowerCase(),
    deployed_optimistic_oracle_address.toLowerCase()
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
