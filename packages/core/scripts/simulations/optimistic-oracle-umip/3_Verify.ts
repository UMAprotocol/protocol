// This script generates and submits an upgrade transaction to add/upgrade the optimistic oracle in the DVM. It can be
// run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to execute the upgrade
// transactions. To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core:
// yarn hardhat run ./scripts/simulations/optimistic-oracle-umip/1_Propose.ts --network localhost --deployedAddress 0xOPTIMISTIC_ORACLE_ADDRESS

const hre = require("hardhat");

const assert = require("assert").strict;

const { RegistryRolesEnum } = require("@uma/common");

import { OptimisticOracleV2, Governor, Finder, Registry } from "../../../contract-types/ethers";

const OPTIMISTIC_ORACLE_V2 = "OptimisticOracleV2"; // TODO use interfaceName.OptimisticOracle

const getAddress = async (contractName: string): Promise<string> => {
  const networkId = await hre.getChainId();
  const addresses = require(`../../../networks/${networkId}.json`);
  return addresses.find((a: { [k: string]: string }) => a.contractName === contractName).address;
};

const getContractInstance = async <T>(contractName: string): Promise<T> => {
  const factory = await hre.ethers.getContractFactory(contractName);
  return (await factory.attach(await getAddress(contractName))) as T;
};

async function main() {
  const optimisticOracleV2 = await getContractInstance<OptimisticOracleV2>("OptimisticOracleV2");
  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const registry = await getContractInstance<Registry>("Registry");

  console.log("Verifying that Governor doesn't hold the creator role...");
  !(await registry.holdsRole(RegistryRolesEnum.CONTRACT_CREATOR, governor.address));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracle is registered with the Registry...");
  assert(await registry.isContractRegistered(optimisticOracleV2.address));
  console.log("Verified!");

  console.log("Verifying that the OptimisticOracleV2 is registered with the Finder...");
  assert.equal(
    (await finder.getImplementationAddress(hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2))).toLowerCase(),
    optimisticOracleV2.address.toLowerCase()
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
