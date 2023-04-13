// This script can be used to propose/dispute approval transaction from Gnosis Safe through Optimistic Governor module.
// It is intended to be used on testnets for generating a sample proposal limited to a single approval transaction.
// Environment:
// - CUSTOM_NODE_URL: URL of the Ethereum node to use (required)
// - MNEMONIC: Mnemonic to use for signing transactions (required)
// - MODULE: Address of Optimistic Governor module (required, unless ASSERTION_ID is provided to dispute existing assertion).
// - ASSERTION_ID: Assertion ID to dispute. If not provided, a new approval proposal will be created using the following parameters:
//   - TOKEN: Address of token to approve. If not provided, it will be set to the collateral token.
//   - AMOUNT: Amount to approve (scaled down to human readable). If not provided, value of "1" will be used.
//   - RECIPIENT: Address of approval beneficiary. If not provided, it will be set to the first mnemonic wallet owner.
// - DISPUTE: Boolean on whether to dispute the proposal. If not provided, the assertion will not be disputed.
// Run:
//   node dist/testnet/OptimisticGovernorRequest.js
// Note:
// - Optimistic Governor module will not accept duplicate proposals. This can happen when DISPUTE was not provided or
//   it was set to false. To resolve this, either:
//   - provide a new proposal with different TOKEN, AMOUNT and RECIPIENT combination,
//   - dispute the previous proposal with this same script by passing ASSERTION_ID and DISPUTE set to true (if not past liveness),
//   - settle and execute the previous proposal with OptimisticGovernorExecute script by passing the same
//     TOKEN, AMOUNT and RECIPIENT environment (if past liveness).

import { Provider, StaticJsonRpcProvider } from "@ethersproject/providers";
import { getMnemonicSigner } from "@uma/common";
import { ERC20Ethers, OptimisticGovernorEthers, OptimisticOracleV3Ethers } from "@uma/contracts-node";
import { BigNumber, utils, Wallet } from "ethers";
import { getContractInstanceWithProvider } from "../utils/contracts";
import { createApprovalPayload } from "../utils/optimisticGovernorPayload";

async function main() {
  const shouldDispute = parseDisputeEnv();
  if (process.env.CUSTOM_NODE_URL === undefined) throw new Error("Must provide CUSTOM_NODE_URL");
  const provider = new StaticJsonRpcProvider(process.env.CUSTOM_NODE_URL);
  const walletSigner = (await getMnemonicSigner()).connect(provider);

  const assertionId =
    process.env.ASSERTION_ID === undefined ? await proposeApproval(walletSigner) : process.env.ASSERTION_ID;

  const expirationTimestamp = Number(await getAssertionExpiration(provider, assertionId));
  if (shouldDispute) {
    const currentTimestamp = (await provider.getBlock("latest")).timestamp;
    if (currentTimestamp >= expirationTimestamp) {
      throw new Error("Assertion is past liveness. Cannot dispute");
    }
    await disputeAssertion(walletSigner, assertionId);
  } else {
    const expirationString = new Date(expirationTimestamp * 1000).toUTCString();
    console.log(
      "Skipping dispute. \n" +
        `- If you want to dispute the assertion, re-run this script before ${expirationString} with \n` +
        "DISPUTE=true \\\n" +
        `ASSERTION_ID=${assertionId} \\`
    );
    if (process.env.ASSERTION_ID === undefined) {
      const optimisticGovernor = await getContractInstanceWithProvider<OptimisticGovernorEthers>(
        "OptimisticGovernor",
        provider,
        process.env.MODULE
      );
      const proposal = await createApprovalPayload(
        provider,
        await optimisticGovernor.collateral(),
        "1",
        walletSigner.address
      );
      console.log(
        `- If you want to execute the proposal, run OptimisticGovernorExecute script at or after ${expirationString} with \n` +
          `MODULE=${process.env.MODULE} \\\n` +
          `TOKEN=${proposal.approvalTokenAddress} \\\n` +
          `AMOUNT=${proposal.approvalAmount} \\\n` +
          `RECIPIENT=${proposal.recipient} \\`
      );
    }
  }
}

function parseDisputeEnv(): boolean {
  if (
    process.env.DISPUTE === undefined ||
    process.env.DISPUTE.toLowerCase() === "false" ||
    process.env.DISPUTE === "0"
  ) {
    return false;
  } else if (process.env.DISPUTE.toLowerCase() === "true" || process.env.DISPUTE === "1") {
    return true;
  } else throw new Error("Invalid DISPUTE value");
}

async function proposeApproval(signer: Wallet): Promise<string> {
  if (process.env.MODULE === undefined) throw new Error("Must provide MODULE as OptimisticGovernor");
  if (!utils.isAddress(process.env.MODULE)) throw new Error("Invalid OptimisticGovernor MODULE address");
  const provider = signer.provider;
  const optimisticGovernor = await getContractInstanceWithProvider<OptimisticGovernorEthers>(
    "OptimisticGovernor",
    provider,
    process.env.MODULE
  );

  // Approve proposal bond.
  const proposalBond = await optimisticGovernor.getProposalBond();
  const collateral = await getContractInstanceWithProvider<ERC20Ethers>(
    "ERC20",
    provider,
    await optimisticGovernor.collateral()
  );
  await (await collateral.connect(signer).approve(optimisticGovernor.address, proposalBond)).wait();

  // Propose approval transaction. Uses TOKEN, AMOUNT and RECIPIENT environment variables if provided.
  const proposal = await createApprovalPayload(provider, collateral.address, "1", signer.address);
  const proposalReceipt = await (
    await optimisticGovernor
      .connect(signer)
      .proposeTransactions(
        [{ to: proposal.approvalTokenAddress, operation: 0, value: 0, data: proposal.proposalPayload }],
        utils.toUtf8Bytes(proposal.explanation)
      )
  ).wait();

  // Get assertionId.
  const proposalEvent = (
    await optimisticGovernor.queryFilter(
      optimisticGovernor.filters.TransactionsProposed(),
      proposalReceipt.blockNumber,
      proposalReceipt.blockNumber
    )
  )[0];
  const assertionId = proposalEvent.args.assertionId;
  console.log("Proposed transaction with explanation:", proposal.explanation);
  console.log("Assertion transaction hash:", proposalReceipt.transactionHash);
  console.log("Assertion ID:", assertionId);
  return assertionId;
}

async function disputeAssertion(signer: Wallet, assertionId: string): Promise<void> {
  const optimisticOracleV3 = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>(
    "OptimisticOracleV3",
    signer.provider
  );

  // Approve dispute bond.
  const assertion = await optimisticOracleV3.getAssertion(assertionId);
  const bondCurrency = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", signer.provider, assertion.currency);
  await (await bondCurrency.connect(signer).approve(optimisticOracleV3.address, assertion.bond)).wait();

  // Dispute assertion.
  const disputeReceipt = await (
    await optimisticOracleV3.connect(signer).disputeAssertion(assertionId, signer.address)
  ).wait();
  console.log("Disputed assertion at", disputeReceipt.transactionHash);
}

async function getAssertionExpiration(provider: Provider, assertionId: string): Promise<BigNumber> {
  const optimisticOracleV3 = await getContractInstanceWithProvider<OptimisticOracleV3Ethers>(
    "OptimisticOracleV3",
    provider
  );
  return (await optimisticOracleV3.getAssertion(assertionId)).expirationTime;
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
