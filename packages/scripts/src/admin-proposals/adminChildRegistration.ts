// To run this on the localhost first fork mainnet into a local hardhat node by running:
// CONTRACT_ADDRESS=<CONTRACT_ADDRESS> \
// CONTRACT_NAME=<CONTRACT_NAME> \
// yarn hardhat run ./src/admin-proposals/adminChildRegistration.ts  --network <network>

const hre = require("hardhat");

import { BytesLike } from "@ethersproject/bytes";
import { AdminChildMessenger, Finder, GovernorSpoke, Registry } from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../utils/contracts";
const { RegistryRolesEnum } = require("@uma/common");

// PARAMETERS
const newContractAddress = process.env.CONTRACT_ADDRESS;
const newContractInterfaceName = process.env.CONTRACT_NAME;

async function main() {
  const finder = await getContractInstance<Finder>("Finder");
  const registry = await getContractInstance<Registry>("Registry");
  const governor = await getContractInstance<GovernorSpoke>("GovernorSpoke");
  const adminChildMessenger = await getContractInstance<AdminChildMessenger>("Admin_ChildMessenger");

  const adminProposalTransactions: {
    to: string;
    data: BytesLike;
  }[] = [];

  if (!newContractAddress) throw new Error("CONTRACT_ADDRESS not set");
  if (!newContractInterfaceName) throw new Error("CONTRACT_NAME not set");

  if (!(await registry.isContractRegistered(newContractAddress))) {
    console.log(`Registering ${newContractAddress} as ${newContractInterfaceName} in ${hre.network.name}`);

    // 1. Temporarily add the Governor as a contract creator.
    const addGovernorToRegistryTx = await registry.populateTransaction.addMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!addGovernorToRegistryTx.data) throw new Error("addGovernorToRegistryTx.data is empty");
    adminProposalTransactions.push({ to: registry.address, data: addGovernorToRegistryTx.data });

    // 2. Register the CONTRACT_NAME as a verified contract.
    const registerNewContractTx = await registry.populateTransaction.registerContract([], newContractAddress);
    if (!registerNewContractTx.data) throw new Error("registerNewContractTx.data is empty");
    adminProposalTransactions.push({ to: registry.address, data: registerNewContractTx.data });

    // 3. Remove the Governor from being a contract creator.
    const removeGovernorFromRegistryTx = await registry.populateTransaction.removeMember(
      RegistryRolesEnum.CONTRACT_CREATOR,
      governor.address
    );
    if (!removeGovernorFromRegistryTx.data) throw new Error("removeGovernorFromRegistryTx.data is empty");
    adminProposalTransactions.push({ to: registry.address, data: removeGovernorFromRegistryTx.data });

    // 4. Add the CONTRACT_NAME to the Finder.
    const addNewContractToFinderTx = await finder.populateTransaction.changeImplementationAddress(
      hre.ethers.utils.formatBytes32String(newContractInterfaceName),
      newContractAddress
    );
    if (!addNewContractToFinderTx.data) throw new Error("addNewContractToFinderTx.data is empty");
    adminProposalTransactions.push({ to: finder.address, data: addNewContractToFinderTx.data });
  } else {
    throw new Error("Contract already registered");
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
    gasLimit: 1_000_000,
  });

  console.log("Contract added to Registry and Finder successfully.");
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
