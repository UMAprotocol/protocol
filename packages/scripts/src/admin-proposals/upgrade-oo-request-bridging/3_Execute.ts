// This script executes a governance vote on Oracle bridging contracts upgrade on the Ethereum mainnet or its fork. It
// also spoofs the relaying of the executed proposal on all forked L2 networks when L1 is forked.
// Export following environment variables:
// - MNEMONIC: Mnemonic for the operator to execute the proposal on L1.
// - NODE_URL_1: Mainnet node URL (not required when using localhost for a forked network).
// - NODE_URL_137: Forked Polygon node URL (not required when using mainnet for L1).
// - NODE_URL_10: Forked Optimism node URL (not required when using mainnet for L1).
// - NODE_URL_42161: Forked Arbitrum node URL (not required when using mainnet for L1).
// - NODE_URL_8453: Forked Base node URL (not required when using mainnet for L1).
// - NODE_URL_81457: Forked Blast node URL (not required when using mainnet for L1).
// - L1_EXECUTE_TX: (optional) L1 transaction hash of the executed proposal, will execute the proposal on L1 if not set.
// - PROPOSAL_NUMBER: (optional) Proposal number to execute, will execute the last proposal if not set.
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/upgrade-oo-request-bridging/3_Execute.ts --network <network>
// Note: use localhost for the forked network, for L1 mainnet need to export NODE_URL_1 environment variable.

import { getMnemonicSigner } from "@uma/common";
import hre from "hardhat";
import {
  getJsonRpcProvider,
  getL1ExecuteProposalReceipt,
  l2Networks,
  ovmNetworks,
  spoofArbitrumRelay,
  spoofOVMRelay,
  spoofPolygonRelay,
} from "../common";

async function main() {
  const l1Signer = getMnemonicSigner().connect(hre.ethers.provider);

  // Executes the proposal on L1 unless L1_EXECUTE_TX was provided.
  const l1TxReceipt = await getL1ExecuteProposalReceipt(l1Signer);

  // Only spoof the relay on L2 when L1 is forked.
  if (hre.network.name !== "localhost") return;

  // Checks node URL for each forked L2 network is set.
  l2Networks.forEach(getJsonRpcProvider);

  // Spoof the relay of executed proposal on each L2.
  for (const networkName of ovmNetworks) {
    await spoofOVMRelay(networkName, l1TxReceipt);
  }
  await spoofArbitrumRelay(l1TxReceipt);
  await spoofPolygonRelay(l1TxReceipt);
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
