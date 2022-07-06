// This script generates and submits an upgrade transaction to add/upgrade the optimistic oracle in the DVM in
// the mainnet and layer 2 blockchains. It can be run on a local hardhat node fork of the mainnet or can be run
// directly on the mainnet to execute the upgrade transactions.
// To run this on the localhost first fork mainnet into a local hardhat node by running:
// HARDHAT_CHAIN_ID=1 yarn hardhat node --fork https://mainnet.infura.io/v3/<YOUR-INFURA-KEY> --port 9545 --no-deploy
// Then execute the script:
// OPTIMISTIC_ORACLE_V2_10=<OPTIMISM-OOV2-ADDRESS> \
// NODE_URL_10=<OPTIMISM-NODE-URL> \
// \
// OPTIMISTIC_ORACLE_V2_288=<BOBA-OOV2-ADDRESS> \
// NODE_URL_288=<OPTIMISM-NODE-URL> \
// \
// OPTIMISTIC_ORACLE_V2_137=<POLYGON-OOV2-ADDRESS> \
// NODE_URL_137=<OPTIMISM-NODE-URL> \
// \
// OPTIMISTIC_ORACLE_V2_42161=<ARBITRUM-OOV2-ADDRESS> \
// NODE_URL_42161=<OPTIMISM-NODE-URL> \
// \
// OPTIMISTC_ORACLE_V2=<MAINNET-OOV2-ADDRESS> \
// \
// yarn hardhat run ./src/upgrade-tests/162/1_Propose.ts  --network localhost

const hre = require("hardhat");

import { BytesLike } from "@ethersproject/bytes";
import { AdminChildMessenger, Finder, GovernorSpoke, Registry } from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../utils/contracts";
const { RegistryRolesEnum } = require("@uma/common");

// PARAMETERS
const deployed_optimistic_oracle_address = process.env.OPTIMISTIC_ORACLE_V2;

const OPTIMISTIC_ORACLE_V2 = "OptimisticOracleV2"; // TODO use interfaceName.OptimisticOracle

async function main() {
  const finder = await getContractInstance<Finder>("Finder");
  const registry = await getContractInstance<Registry>("Registry");
  const governor = await getContractInstance<GovernorSpoke>("GovernorSpoke");
  const adminChildMessenger = await getContractInstance<AdminChildMessenger>("Admin_ChildMessenger");

  const adminProposalTransactions: {
    to: string;
    data: BytesLike;
  }[] = [];

  if (!deployed_optimistic_oracle_address) throw new Error("OPTIMISTIC_ORACLE_V2 not set");

  if (!(await registry.isContractRegistered(deployed_optimistic_oracle_address))) {
    console.log(`Registering ${deployed_optimistic_oracle_address} on mainnet`);

    // 1. Temporarily add the Governor as a contract creator.
    const addGovernorToRegistryTx = await registry.populateTransaction.addMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!addGovernorToRegistryTx.data) throw new Error("addGovernorToRegistryTx.data is empty");
    adminProposalTransactions.push({ to: registry.address, data: addGovernorToRegistryTx.data });

    // 2. Register the OptimisticOracle as a verified contract.
    const registerOptimisticOracleTx = await registry.populateTransaction.registerContract(
      [],
      deployed_optimistic_oracle_address
    );
    if (!registerOptimisticOracleTx.data) throw new Error("registerOptimisticOracleTx.data is empty");
    adminProposalTransactions.push({ to: registry.address, data: registerOptimisticOracleTx.data });

    // 3. Remove the Governor from being a contract creator.
    const removeGovernorFromRegistryTx = await registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!removeGovernorFromRegistryTx.data) throw new Error("removeGovernorFromRegistryTx.data is empty");
    adminProposalTransactions.push({ to: registry.address, data: removeGovernorFromRegistryTx.data });

    // 4. Add the OptimisticOracle to the Finder.
    const addOptimisticOracleToFinderTx = await finder.populateTransaction.changeImplementationAddress(
      hre.ethers.utils.formatBytes32String(OPTIMISTIC_ORACLE_V2),
      deployed_optimistic_oracle_address
    );
    if (!addOptimisticOracleToFinderTx.data) throw new Error("addOptimisticOracleToFinderTx.data is empty");
    adminProposalTransactions.push({ to: finder.address, data: addOptimisticOracleToFinderTx.data });
  }

  const calldata: string = hre.ethers.utils.defaultAbiCoder.encode(
    [
      {
        type: "tuple[]",
        components: [
          { name: "to", type: "address" },
          { name: "data", type: "bytes" },
        ],
      },
    ],
    [adminProposalTransactions]
  );

  await adminChildMessenger.processMessageFromCrossChainParent(calldata, governor.address, {
    gasLimit: 10_000_000,
  });

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
