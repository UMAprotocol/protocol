// This script can be run against a public or forked networks.
// Export following environment variables:
// - NODE_URL_1: Mainnet node URL (not required when using localhost for a forked network).
// - NODE_URL_137: Public or forked Polygon node URL.
// - NODE_URL_10: Public or forked Optimism node URL.
// - NODE_URL_42161: Public or forked Arbitrum node URL.
// - NODE_URL_8453: Public or forked Base node URL.
// - NODE_URL_81457: Public or forked Blast node URL.
// - GCKMS_WALLET: GCKMS wallet name, required only on public mainnet.
// - IDENTIFIER: Identifier to remove.
// - UMIP_NUMBER: UMIP number to use in the proposal title.
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/remove-identifier/0_Propose.ts --network <network>
// Note: use localhost for the forked network, for L1 mainnet need to export NODE_URL_1 environment variable.

import hre from "hardhat";

import {
  GovernorHubEthers,
  GovernorRootTunnelEthers,
  IdentifierWhitelistEthers,
  ParentMessengerBaseEthers,
  ProposerV2Ethers,
  VotingTokenEthers,
} from "@uma/contracts-node";

import { PopulatedTransaction } from "ethers";
import { formatBytes32String } from "ethers/lib/utils";
import { getContractInstance, getContractInstanceWithProvider } from "../../utils/contracts";
import { fundArbitrumParentMessengerForRelays, relayGovernanceMessages } from "../../utils/relay";
import {
  AdminProposalTransaction,
  PROPOSER_ADDRESS,
  getProposerSigner,
  getUmipNumber,
  isSupportedNetwork,
  networksNumber,
  supportedNetworks,
} from "../common";
import { getRetryProvider } from "@uma/common";

async function main() {
  const adminProposalTransactions: AdminProposalTransaction[] = [];

  if (!process.env.IDENTIFIER) throw new Error("IDENTIFIER is not set");
  const oldIdentifier = formatBytes32String(process.env.IDENTIFIER);

  const umipNumber = getUmipNumber();

  const arbitrumParentMessenger = await getContractInstance<ParentMessengerBaseEthers>("Arbitrum_ParentMessenger");

  const governorRootTunnel = await getContractInstance<GovernorRootTunnelEthers>("GovernorRootTunnel"); // for polygon
  const governorHub = await getContractInstance<GovernorHubEthers>("GovernorHub"); // rest of l2

  const proposerSigner = await getProposerSigner(PROPOSER_ADDRESS);

  console.log("1. LOADING DEPLOYED CONTRACT STATE");

  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");

  const proposerV2 = await getContractInstance<ProposerV2Ethers>("ProposerV2");
  const identifierWhitelist = await getContractInstance<IdentifierWhitelistEthers>("IdentifierWhitelist");

  // remove the identifier from whitelist
  const removeIdentifierTx = await identifierWhitelist.populateTransaction.removeSupportedIdentifier(oldIdentifier);
  if (!removeIdentifierTx.data) throw "removeIdentifierTx.data is null";
  adminProposalTransactions.push({ to: identifierWhitelist.address, value: 0, data: removeIdentifierTx.data });

  for (const networkName of supportedNetworks.filter((network) => network !== "mainnet")) {
    if (!isSupportedNetwork(networkName)) throw new Error(`Unsupported network: ${networkName}`);
    const l2ChainId = networksNumber[networkName];
    const isPolygon = l2ChainId === 137;
    const isArbitrum = l2ChainId === 42161;

    const governanceMessages: { targetAddress: string; tx: PopulatedTransaction }[] = [];

    const l2IdentifierWhitelist = await getContractInstanceWithProvider<IdentifierWhitelistEthers>(
      "IdentifierWhitelist",
      getRetryProvider(l2ChainId)
    );

    const removeIdentifierL2Tx = await l2IdentifierWhitelist.populateTransaction.removeSupportedIdentifier(
      oldIdentifier
    );
    governanceMessages.push({ targetAddress: l2IdentifierWhitelist.address, tx: removeIdentifierL2Tx });

    if (isArbitrum) await fundArbitrumParentMessengerForRelays(arbitrumParentMessenger, proposerSigner, 1);

    const relayedMessages = await relayGovernanceMessages(
      governanceMessages,
      isPolygon ? governorRootTunnel : governorHub,
      l2ChainId
    );

    adminProposalTransactions.push(...relayedMessages);
  }

  const defaultBond = await proposerV2.bond();
  const allowance = await votingToken.allowance(PROPOSER_ADDRESS, proposerV2.address);
  if (allowance.lt(defaultBond)) {
    console.log("Approving proposer bond");
    const approveTx = await votingToken.connect(proposerSigner).approve(proposerV2.address, defaultBond);
    await approveTx.wait();
  }

  const tx = await (await getContractInstance<ProposerV2Ethers>("ProposerV2", proposerV2.address))
    .connect(proposerSigner)
    .propose(
      adminProposalTransactions,
      hre.ethers.utils.toUtf8Bytes(`UMIP-${umipNumber} remove ${process.env.IDENTIFIER} identifier`)
    );

  await tx.wait();

  console.log("Proposal done!🎉");
  console.log("\nProposal data:\n", tx.data);
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
