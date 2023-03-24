// This script can be used to register an arbitrary contract in a multi-sig (non-rollup) chain in
// the network's Registry and Finder contracts deployments.
// The scripts executes the required actions through the Admin_ChilMessenger of the target network.
// Therefore the Wallet used need to be the owner of Admin_ChilMessenger.
// The contract address and name to verify should be passed as environment variables: CONTRACT_ADDRESS and CONTRACT_NAME.
// If the Admin_ChilMessenger is owned by a Gnosis Safe, the address of the Safe should be passed as optional
// environment variable: GNOSIS_SAFE and the script will only save the transaction payload to a file.
// Run it with:
// CONTRACT_ADDRESS=<CONTRACT_ADDRESS> \
// CONTRACT_NAME=<CONTRACT_NAME> \
// GNOSIS_SAFE=<GNOSIS_SAFE> \
// yarn hardhat run ./src/admin-proposals/adminChildRegistration.ts  --network <network>

const hre = require("hardhat");

import { BytesLike } from "@ethersproject/bytes";
import { AdminChildMessenger, Finder, GovernorSpoke, Registry } from "@uma/contracts-node/typechain/core/ethers";
import { getContractInstance } from "../utils/contracts";
import { baseSafePayload, appendTxToSafePayload } from "../utils/gnosisPayload";
const { RegistryRolesEnum } = require("@uma/common");

import fs from "fs";
import path from "path";

// PARAMETERS
const newContractAddress = process.env.CONTRACT_ADDRESS;
const newContractInterfaceName = process.env.CONTRACT_NAME;
const safe = process.env.GNOSIS_SAFE || "";

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

    // 2. Register the CONTRACT_ADDRESS as a verified contract.
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

  if (safe === "") {
    const tx = await adminChildMessenger.processMessageFromCrossChainParent(calldata, governor.address);

    await tx.wait();

    console.log("Contract added to Registry and Finder successfully.");
  } else {
    const chainId = (await hre.ethers.provider.getNetwork()).chainId;
    let payload = baseSafePayload(
      chainId,
      "AdminChildRegistration",
      `Registers ${newContractInterfaceName} as ${newContractAddress} on chainId ${chainId}`,
      safe
    );
    payload = appendTxToSafePayload(payload, adminChildMessenger.address, processMessageFromCrossChainParentInput, {
      data: calldata,
      target: governor.address,
    });
    const savePath = `${path.resolve(__dirname)}/out/admin_child_registration_payload.json`;
    fs.writeFileSync(savePath, JSON.stringify(payload, null, 4));

    console.log("Payload saved!");
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

const processMessageFromCrossChainParentInput = {
  inputs: [
    { internalType: "bytes", name: "data", type: "bytes" },
    { internalType: "address", name: "target", type: "address" },
  ],
  name: "processMessageFromCrossChainParent",
  payable: false,
};
