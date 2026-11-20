// This script proposes a governance vote to make the DisputeRouter the Oracle on Polygon.
// Export following environment variables:
// - NODE_URL_1: Mainnet node URL (not required when using localhost for a forked network).
// - GCKMS_WALLET: (optional) GCKMS wallet name, impersonates the proposer on a fork if not set.
// - UMIP_NUMBER: Number in UMIP repository.
// - ROUTER_ADDRESS: (optional) DisputeRouter proxy address on Polygon, defaults to the deployed proxy.
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/dispute-router-cutover/0_Propose.ts --network <network>

import {
  FinderEthers,
  getAddress,
  GovernorRootTunnelEthers,
  OptimisticOracleV3Ethers,
  RegistryEthers,
} from "@uma/contracts-node";
import { interfaceName, RegistryRolesEnum } from "@uma/common";
import { constants as ethersConstants, utils as ethersUtils } from "ethers";
import {
  AdminProposalTransaction,
  approveProposerBond,
  getProposerSigner,
  getUmipNumber,
  networksNumber,
  PROPOSER_ADDRESS,
  submitAdminProposal,
} from "../common";
import { getContractInstance } from "../../utils/contracts";
import { GovernanceMessages, relayGovernanceMessages } from "../../utils/relay";
import { getRouterAddress } from "./common";

async function main() {
  const umipNumber = getUmipNumber();
  const routerAddress = getRouterAddress();
  const polygonChainId = networksNumber["polygon"];

  const proposerSigner = await getProposerSigner(PROPOSER_ADDRESS);

  const governorRootTunnel = await getContractInstance<GovernorRootTunnelEthers>("GovernorRootTunnel");
  const registry = await getContractInstance<RegistryEthers>("Registry", undefined, polygonChainId);
  const finder = await getContractInstance<FinderEthers>("Finder", undefined, polygonChainId);
  const optimisticOracleV3 = await getContractInstance<OptimisticOracleV3Ethers>(
    "OptimisticOracleV3",
    undefined,
    polygonChainId
  );
  const governorChildTunnelAddress = await getAddress("GovernorChildTunnel", polygonChainId);

  // Registering the router lets it call OracleChildTunnel.requestPrice and read prices from the legacy oracle.
  const governanceMessages: GovernanceMessages = [
    {
      targetAddress: registry.address,
      tx: await registry.populateTransaction.addMember(RegistryRolesEnum.CONTRACT_CREATOR, governorChildTunnelAddress),
    },
    { targetAddress: registry.address, tx: await registry.populateTransaction.registerContract([], routerAddress) },
    {
      targetAddress: registry.address,
      tx: await registry.populateTransaction.removeMember(
        RegistryRolesEnum.CONTRACT_CREATOR,
        governorChildTunnelAddress
      ),
    },
    {
      targetAddress: finder.address,
      tx: await finder.populateTransaction.changeImplementationAddress(
        ethersUtils.formatBytes32String(interfaceName.Oracle),
        routerAddress
      ),
    },
    // OOv3 caches the Oracle address, so sync it in the same batch to switch atomically.
    {
      targetAddress: optimisticOracleV3.address,
      tx: await optimisticOracleV3.populateTransaction.syncUmaParams(
        ethersUtils.formatBytes32String(""),
        ethersConstants.AddressZero
      ),
    },
  ];
  const adminProposalTransactions: AdminProposalTransaction[] = await relayGovernanceMessages(
    governanceMessages,
    governorRootTunnel,
    polygonChainId
  );

  await approveProposerBond(proposerSigner);

  const proposalExplanation = `UMIP-${umipNumber}: Set DisputeRouter ${routerAddress} as Oracle on Polygon`;
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
