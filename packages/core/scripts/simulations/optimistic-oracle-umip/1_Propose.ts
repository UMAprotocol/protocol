// This script generates and submits an upgrade transaction to add/upgrade the optimistic oracle in the DVM. It can be
// run on a local hardhat node fork of the mainnet or can be run directly on the mainnet to execute the upgrade
// transactions. To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script from core:
// yarn hardhat run ./scripts/simulations/optimistic-oracle-umip/1_Propose.ts --network localhost --deployedAddress 0xOPTIMISTIC_ORACLE_ADDRESS

const hre = require("hardhat");

const { RegistryRolesEnum } = require("@uma/common");

import { Signer } from "ethers/lib/ethers";
import { OptimisticOracleV2, Proposer, Governor, Finder, Registry } from "../../../contract-types/ethers";

// PARAMETERS
const proposerWallet = "0x2bAaA41d155ad8a4126184950B31F50A1513cE25";

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

async function impersonateAccount(account: string): Promise<Signer> {
  await hre.network.provider.request({ method: "hardhat_impersonateAccount", params: [account] });
  return hre.ethers.getSigner(account);
}

async function main() {
  const proposerSigner = await impersonateAccount(proposerWallet);

  const optimisticOracleV2 = await getContractInstance<OptimisticOracleV2>("OptimisticOracleV2");
  const finder = await getContractInstance<Finder>("Finder");
  const governor = await getContractInstance<Governor>("Governor");
  const registry = await getContractInstance<Registry>("Registry");
  const proposer = await getContractInstance<Proposer>("Proposer");

  // 1. Temporarily add the Governor as a contract creator.
  const addGovernorToRegistryTx = await registry.populateTransaction.addMember(
    RegistryRolesEnum.CONTRACT_CREATOR,
    governor.address
  );

  console.log("addGovernorToRegistryTx", addGovernorToRegistryTx);

  // 2. Register the OptimisticOracle as a verified contract.
  const registerOptimisticOracleTx = await registry.populateTransaction.registerContract(
    [],
    optimisticOracleV2.address
  );

  console.log("registerOptimisticOracleTx", registerOptimisticOracleTx);

  // 3. Remove the Governor from being a contract creator.
  const removeGovernorFromRegistryTx = await registry.populateTransaction.removeMember(
    RegistryRolesEnum.CONTRACT_CREATOR,
    governor.address
  );

  console.log("removeGovernorFromRegistryTx", removeGovernorFromRegistryTx);

  // 4. Add the OptimisticOracle to the Finder.
  const addOptimisticOracleToFinderTx = await finder.populateTransaction.changeImplementationAddress(
    hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2),
    optimisticOracleV2.address
  );

  console.log("addOptimisticOracleToFinderTx", addOptimisticOracleToFinderTx);

  console.log("Proposing...");

  // Send the proposal
  if (
    addGovernorToRegistryTx.data &&
    registerOptimisticOracleTx.data &&
    removeGovernorFromRegistryTx.data &&
    addOptimisticOracleToFinderTx.data
  ) {
    await proposer.connect(proposerSigner).propose(
      [
        { to: registry.address, value: 0, data: addGovernorToRegistryTx.data },
        { to: registry.address, value: 0, data: registerOptimisticOracleTx.data },
        { to: registry.address, value: 0, data: removeGovernorFromRegistryTx.data },
        { to: finder.address, value: 0, data: addOptimisticOracleToFinderTx.data },
      ],
      { gasLimit: 2000000 }
    );
  }

  console.log("Proposal Done.");
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
