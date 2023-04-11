// This script can be used to execute approval transaction from Gnosis Safe through Optimistic Governor module.
// It is intended to be used on testnets for executing a sample proposal limited to a single approval transaction.
// Environment (all required):
// - CUSTOM_NODE_URL: URL of the Ethereum node to use.
// - MNEMONIC: Mnemonic to use for signing transactions.
// - MODULE: Address of Optimistic Governor module where approval transaction was proposed.
// - TOKEN: Address of token to approve. Must match the same token from undisputed proposal.
// - AMOUNT: Amount to approve (scaled down to human readable). Must match the same amount from undisputed proposal.
// - RECIPIENT: Address of approval beneficiary. Must match the same recipient from undisputed proposal.
// Run:
//   node dist/testnet/OptimisticGovernorExecute.js
// Note:
// - Optimistic Governor module will only execute undisputed proposals that are past their liveness.

import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { getMnemonicSigner } from "@uma/common";
import { OptimisticGovernorEthers } from "@uma/contracts-node";
import { utils } from "ethers";
import { getContractInstanceWithProvider } from "../utils/contracts";
import { createApprovalPayload } from "../utils/optimisticGovernorPayload";

async function main() {
  if (process.env.CUSTOM_NODE_URL === undefined) throw new Error("Must provide CUSTOM_NODE_URL");
  const provider = new StaticJsonRpcProvider(process.env.CUSTOM_NODE_URL);
  const walletSigner = (await getMnemonicSigner()).connect(provider);

  if (process.env.MODULE === undefined) throw new Error("Must provide MODULE as OptimisticGovernor");
  if (!utils.isAddress(process.env.MODULE)) throw new Error("Invalid OptimisticGovernor MODULE address");
  const optimisticGovernor = await getContractInstanceWithProvider<OptimisticGovernorEthers>(
    "OptimisticGovernor",
    provider,
    process.env.MODULE
  );

  // Reconstruct and execute the proposed approval transaction. Must have TOKEN, AMOUNT and RECIPIENT environment variables set.
  const proposal = await createApprovalPayload(provider);
  const executelReceipt = await (
    await optimisticGovernor
      .connect(walletSigner)
      .executeProposal([{ to: proposal.approvalTokenAddress, operation: 0, value: 0, data: proposal.proposalPayload }])
  ).wait();
  console.log("Executed proposal explanation:", proposal.explanation);
  console.log("Executed proposal in transaction:", executelReceipt.transactionHash);
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
