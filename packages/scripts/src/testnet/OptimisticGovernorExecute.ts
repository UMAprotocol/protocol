import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { getContractInstanceWithProvider, getMnemonicSigner } from "@uma/common";
import { OptimisticGovernorEthers } from "@uma/contracts-node";
import { utils } from "ethers";
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
