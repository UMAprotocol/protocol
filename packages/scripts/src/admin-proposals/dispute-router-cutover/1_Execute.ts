// This script executes the DisputeRouter cutover proposal on the Ethereum mainnet or its fork. When L1 is forked it
// also spoofs relaying the executed proposal on the forked Polygon network.
// Export following environment variables:
// - MNEMONIC: Mnemonic for the operator to execute the proposal on L1.
// - NODE_URL_1: Mainnet node URL (not required when using localhost for a forked network).
// - NODE_URL_137: Forked Polygon node URL (not required when using mainnet for L1).
// - L1_EXECUTE_TX: (optional) L1 transaction hash of the executed proposal, will execute the proposal on L1 if not set.
// - PROPOSAL_NUMBER: (optional) Proposal number to execute, will execute the last proposal if not set.
// Then run the script with:
//   yarn hardhat run packages/scripts/src/admin-proposals/dispute-router-cutover/1_Execute.ts --network <network>

import { getMnemonicSigner } from "@uma/common";
import hre from "hardhat";
import { getJsonRpcProvider, getL1ExecuteProposalReceipt, spoofPolygonRelay } from "../common";

async function main() {
  const l1Signer = getMnemonicSigner().connect(hre.ethers.provider);

  const l1TxReceipt = await getL1ExecuteProposalReceipt(l1Signer);

  if (hre.network.name !== "localhost") return;

  getJsonRpcProvider("polygon");
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
