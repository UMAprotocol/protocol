// This script can be used to propose/dispute approval transaction from Gnosis Safe through Optimistic Governor module.
// Environment:
// - CUSTOM_NODE_URL: URL of the Ethereum node to use (required)
// - MNEMONIC: Mnemonic to use for signing transactions (required)
// - MODULE: Address of Optimistic Governor module (required, unless ASSERTION_ID is provided to dispute existing assertion).
// - ASSERTION_ID: Assertion ID to dispute. If not provided, a new approval proposal will be created using the following parameters:
//   - TOKEN: Address of token to approve. If not provided, it will be set to the collateral token.
//   - AMOUNT: Amount to approve (scaled down to human readable). If not provided, value of "1" will be used.
//   - RECIPIENT: Address of approval beneficiary. If not provided, it will be set to the first mnemonic wallet owner.
// - DISPUTE: Boolean on whether to dispute the proposal. If not provided, the assertion will be disputed by default.
// Run:
//   node dist/testnet/OptimisticGovernorRequest.js
// Note:
// - Optimistic Governor module will not accept duplicate proposals. This can happen when DISPUTE was set to "false". Either:
//   - provide a new proposal with different TOKEN, AMOUNT and RECIPIENT combination,
//   - dispute the previous proposal by passing ASSERTION_ID (if not past liveness),
//   - settle and execute the previous proposal (if past liveness).

import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { getContractInstanceWithProvider, getMnemonicSigner } from "@uma/common";
import { ERC20Ethers, OptimisticGovernorEthers, OptimisticOracleV3Ethers } from "@uma/contracts-node";
import { utils, Wallet } from "ethers";

async function main() {
  const shouldDispute = parseDisputeEnv();
  if (process.env.CUSTOM_NODE_URL === undefined) throw new Error("Must provide CUSTOM_NODE_URL");
  const provider = new StaticJsonRpcProvider(process.env.CUSTOM_NODE_URL);
  const walletSigner = (await getMnemonicSigner()).connect(provider);

  const assertionId =
    process.env.ASSERTION_ID === undefined ? await proposeApproval(walletSigner) : process.env.ASSERTION_ID;

  if (shouldDispute) {
    await disputeAssertion(walletSigner, assertionId);
  } else {
    console.log(
      `Skipping dispute. If you want to dispute the assertion, re-run with DISPUTE=true ASSERTION_ID=${assertionId}`
    );
  }
}

function parseDisputeEnv(): boolean {
  if (
    process.env.DISPUTE === undefined ||
    process.env.DISPUTE.toLowerCase() === "true" ||
    process.env.DISPUTE === "1"
  ) {
    return true;
  } else if (process.env.DISPUTE.toLowerCase() === "false" || process.env.DISPUTE === "0") {
    return false;
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
  await collateral.connect(signer).approve(optimisticGovernor.address, proposalBond);

  // Construct proposed approval transaction.
  const approvalTokenAddress = process.env.TOKEN !== undefined ? process.env.TOKEN : collateral.address;
  if (!utils.isAddress(approvalTokenAddress)) throw new Error("Invalid approval token address");
  const approvalToken = await getContractInstanceWithProvider<ERC20Ethers>("ERC20", provider, approvalTokenAddress);
  const symbol = await approvalToken.symbol();
  const decimals = await approvalToken.decimals();
  const approvalAmount =
    process.env.AMOUNT !== undefined ? utils.parseUnits(process.env.AMOUNT, decimals) : utils.parseUnits("1", decimals);
  const recipient = process.env.RECIPIENT !== undefined ? process.env.RECIPIENT : signer.address;
  if (!utils.isAddress(recipient)) throw new Error("Invalid recipient address");
  const proposalPayload = approvalToken.interface.encodeFunctionData("approve", [recipient, approvalAmount]);
  const explanation = utils.toUtf8Bytes(
    `Approve ${utils.formatUnits(approvalAmount, decimals)} ${symbol} to ${recipient}`
  );

  // Propose approval transaction.
  const proposalReceipt = await (
    await optimisticGovernor
      .connect(signer)
      .proposeTransactions([{ to: approvalToken.address, operation: 0, value: 0, data: proposalPayload }], explanation)
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
  console.log("Proposed transaction with explanation:", utils.toUtf8String(explanation));
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
  await bondCurrency.connect(signer).approve(optimisticOracleV3.address, assertion.bond);

  // Dispute assertion.
  const disputeReceipt = await (
    await optimisticOracleV3.connect(signer).disputeAssertion(assertionId, signer.address)
  ).wait();
  console.log("Disputed assertion at", disputeReceipt.transactionHash);
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
