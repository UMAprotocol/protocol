// This script proposes a governance vote on Oracle bridging contracts upgrade.
// Make sure that the newly deployed bridging contracts have been added to the networks config in the `core` package and
// the `contracts-node` package has been rebuilt.
// Export following environment variables:
// - NODE_URL_1: Mainnet node URL (not required when using localhost for a forked network).
// - GCKMS_WALLET: (optional) GCKMS wallet name
// - UMIP_NUMBER: Number in UMIP repository
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/2_Propose.ts --network <network>
// Note: use localhost for the forked network, for mainnet also need to export NODE_URL_1 environment variable.

import {
  FinderEthers,
  getAddress,
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  OptimisticOracleV3Ethers,
  RegistryEthers,
} from "@uma/contracts-node";
import {
  AdminProposalTransaction,
  PROPOSER_ADDRESS,
  getUmipNumber,
  getProposerSigner,
  rollupNetworks,
  networksNumber,
  getParentMessenger,
  approveProposerBond,
  submitAdminProposal,
  appendAdminProposalTransaction,
} from "../common";
import { PopulatedTransaction, utils as ethersUtils, constants as ethersConstants } from "ethers";
import { getContractInstance } from "../../utils/contracts";
import {
  fundArbitrumParentMessengerForRelays,
  relayGovernanceHubMessages,
  relayGovernanceRootTunnelMessage,
} from "../../utils/relay";
import { RegistryRolesEnum, interfaceName } from "@uma/common";

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

  const umipNumber = getUmipNumber();

  const proposerSigner = await getProposerSigner(PROPOSER_ADDRESS);

  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub");
  const governorRootTunnel = await getContractInstance<GovernorRootTunnelEthers>("GovernorRootTunnel");
  const registry = await getContractInstance<RegistryEthers>("Registry");
  const polygonFinder = await getContractInstance<FinderEthers>("Finder", undefined, networksNumber["polygon"]);
  const polygonOptimisticOracleV3 = await getContractInstance<OptimisticOracleV3Ethers>(
    "OptimisticOracleV3",
    undefined,
    networksNumber["polygon"]
  );

  const governorV2Address = await getAddress("GovernorV2", networksNumber["mainnet"]);
  const oracleRootTunnelAddress = await getAddress("OracleRootTunnel", networksNumber["mainnet"]);
  const oracleChildTunnelAddress = await getAddress("OracleChildTunnel", networksNumber["polygon"]);

  // Update OracleSpoke for each rollup network
  for (const networkName of rollupNetworks) {
    const l2ChainId = networksNumber[networkName];
    const oracleSpokeAddress = await getAddress("OracleSpoke", l2ChainId);
    const parentMessenger = await getParentMessenger(networkName);
    const finder = await getContractInstance<FinderEthers>("Finder", undefined, l2ChainId);
    const optimisticOracleV3 = await getContractInstance<OptimisticOracleV3Ethers>(
      "OptimisticOracleV3",
      undefined,
      l2ChainId
    );

    // Set OracleSpoke in ParentMessenger
    const setOracleSpokeTx = await parentMessenger.populateTransaction.setOracleSpoke(oracleSpokeAddress);
    appendAdminProposalTransaction(adminProposalTransactions, setOracleSpokeTx);

    // Set OracleSpoke in ChildMessenger
    const setChildOracleSpokeTx = await parentMessenger.populateTransaction.setChildOracleSpoke(oracleSpokeAddress);
    appendAdminProposalTransaction(adminProposalTransactions, setChildOracleSpokeTx);

    // Set OracleSpoke as Oracle in L2 Finder and sync the cached value in OptimisticOracleV3 atomically
    const governanceMessages: { targetAddress: string; tx: PopulatedTransaction }[] = [];
    const changeImplementationAddressTx = await finder.populateTransaction.changeImplementationAddress(
      ethersUtils.formatBytes32String(interfaceName.Oracle),
      oracleSpokeAddress
    );
    governanceMessages.push({ targetAddress: finder.address, tx: changeImplementationAddressTx });
    const syncUmaParamsTx = await optimisticOracleV3.populateTransaction.syncUmaParams(
      ethersUtils.formatBytes32String(""),
      ethersConstants.AddressZero
    );
    governanceMessages.push({ targetAddress: optimisticOracleV3.address, tx: syncUmaParamsTx });
    const relayedMessages = await relayGovernanceHubMessages(governanceMessages, governorHub, l2ChainId);
    adminProposalTransactions.push(...relayedMessages);

    // There are 2 crosschain messages for Arbitrum to fund (setChildOracleSpoke and sendMessageToChild)
    if (networkName === "arbitrum") await fundArbitrumParentMessengerForRelays(parentMessenger, proposerSigner, 2);
  }

  // Register the new OracleRootTunnel so its able to make DVM requests
  const addMemberTx = await registry.populateTransaction.addMember(
    RegistryRolesEnum.CONTRACT_CREATOR,
    governorV2Address
  );
  const registerContractTx = await registry.populateTransaction.registerContract([], oracleRootTunnelAddress);
  const removeMemberTx = await registry.populateTransaction.removeMember(
    RegistryRolesEnum.CONTRACT_CREATOR,
    governorV2Address
  );
  appendAdminProposalTransaction(adminProposalTransactions, addMemberTx);
  appendAdminProposalTransaction(adminProposalTransactions, registerContractTx);
  appendAdminProposalTransaction(adminProposalTransactions, removeMemberTx);

  // Set the new OracleChildTunnel as Oracle in the Polygon Finder
  const changeImplementationAddressTx = await polygonFinder.populateTransaction.changeImplementationAddress(
    ethersUtils.formatBytes32String(interfaceName.Oracle),
    oracleChildTunnelAddress
  );
  adminProposalTransactions.push(
    await relayGovernanceRootTunnelMessage(polygonFinder.address, changeImplementationAddressTx, governorRootTunnel)
  );

  // Sync the cached Oracle value in Polygon OptimisticOracleV3 to the new OracleChildTunnel
  const syncUmaParamsTx = await polygonOptimisticOracleV3.populateTransaction.syncUmaParams(
    ethersUtils.formatBytes32String(""),
    ethersConstants.AddressZero
  );
  adminProposalTransactions.push(
    await relayGovernanceRootTunnelMessage(polygonOptimisticOracleV3.address, syncUmaParamsTx, governorRootTunnel)
  );

  // Approve proposer bond if needed
  await approveProposerBond(proposerSigner);

  // Submit the admin proposal
  const proposalExplanation = `UMIP-${umipNumber}: Upgrade oracle request bridging contracts`;
  await submitAdminProposal(proposerSigner, adminProposalTransactions, proposalExplanation);
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
