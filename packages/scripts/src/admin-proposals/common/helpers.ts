import { getGckmsSigner } from "@uma/common";
import { DeploymentName, getAddress, GovernorV2Ethers, ProposerV2Ethers, VotingTokenEthers } from "@uma/contracts-node";
import {
  ArbitrumChildMessenger,
  ArbitrumParentMessenger,
  OptimismChildMessenger,
  OptimismParentMessenger,
} from "@uma/contracts-node/dist/packages/contracts-node/typechain/core/ethers";
import { TransactionReceipt } from "@ethersproject/abstract-provider";
import { JsonRpcProvider, JsonRpcSigner } from "@ethersproject/providers";
import { PopulatedTransaction, Signer, utils as ethersUtils, constants as ethersConstants } from "ethers";
import hre from "hardhat";
import { getContractInstance, getContractInstanceWithProvider } from "../../utils/contracts";
import { networksNumber, OVMNetwork, RollupNetwork, SupportedNetwork } from "./networks";
import { AdminProposalTransaction, ProposalToExecute } from "./types";

export const getUmipNumber = (): number => {
  const umipNumber = Number(process.env.UMIP_NUMBER);
  if (!Number.isInteger(umipNumber)) throw new Error("Missing or invalid UMIP_NUMBER env");
  return umipNumber;
};

export const getProposerSigner = async (proposerAddress: string): Promise<Signer> => {
  let proposerSigner: Signer;

  if (process.env.GCKMS_WALLET) {
    proposerSigner = (await getGckmsSigner()).connect(hre.ethers.provider);
    if (proposerAddress.toLowerCase() != (await proposerSigner.getAddress()).toLowerCase())
      throw new Error("GCKMS wallet does not match proposer wallet");
  } else {
    proposerSigner = await hre.ethers.getSigner(proposerAddress);
  }
  return proposerSigner;
};

export const getParentMessengerAddress = async (networkName: SupportedNetwork): Promise<string> => {
  const networkNameFirstCapitalLetter = networkName.charAt(0).toUpperCase() + networkName.slice(1);
  return await getAddress(`${networkNameFirstCapitalLetter}_ParentMessenger` as DeploymentName, 1);
};

export const getParentMessenger = async (
  networkName: RollupNetwork
): Promise<ArbitrumParentMessenger | OptimismParentMessenger> => {
  const networkNameFirstCapitalLetter = networkName.charAt(0).toUpperCase() + networkName.slice(1);
  const deploymentName = `${networkNameFirstCapitalLetter}_ParentMessenger` as DeploymentName;
  const contractName = networkName === "arbitrum" ? "Arbitrum_ParentMessenger" : "Optimism_ParentMessenger";
  const parentMessengerAddress = await getAddress(deploymentName, 1);
  return await getContractInstance<ArbitrumParentMessenger | OptimismParentMessenger>(
    contractName,
    parentMessengerAddress,
    1
  );
};

export const getOVMParentMessenger = async (networkName: OVMNetwork): Promise<OptimismParentMessenger> => {
  const networkNameFirstCapitalLetter = networkName.charAt(0).toUpperCase() + networkName.slice(1);
  const deploymentName = `${networkNameFirstCapitalLetter}_ParentMessenger` as DeploymentName;
  const parentMessengerAddress = await getAddress(deploymentName, 1);
  return await getContractInstance<OptimismParentMessenger>("Optimism_ParentMessenger", parentMessengerAddress, 1);
};

export const getChildMessenger = async (
  networkName: RollupNetwork
): Promise<ArbitrumChildMessenger | OptimismChildMessenger> => {
  const l2Provider = await getJsonRpcProvider(networkName);
  const chainId = networksNumber[networkName];
  const networkNameFirstCapitalLetter = networkName.charAt(0).toUpperCase() + networkName.slice(1);
  const deploymentName = `${networkNameFirstCapitalLetter}_ChildMessenger` as DeploymentName;
  const contractName = networkName === "arbitrum" ? "Arbitrum_ChildMessenger" : "Optimism_ChildMessenger";
  const childMessengerAddress = await getAddress(deploymentName, chainId);
  return await getContractInstanceWithProvider<ArbitrumChildMessenger | OptimismChildMessenger>(
    contractName,
    l2Provider,
    childMessengerAddress
  );
};

export const appendAdminProposalTransaction = (
  adminProposalTransactions: AdminProposalTransaction[],
  tx: PopulatedTransaction
): void => {
  if (!tx.to) throw "tx.to is undefined";
  if (!tx.data) throw "tx.data is undefined";
  adminProposalTransactions.push({ to: tx.to, value: tx.value || 0, data: tx.data });
};

export const approveProposerBond = async (signer: Signer): Promise<void> => {
  const proposer = await getContractInstance<ProposerV2Ethers>("ProposerV2");
  const votingToken = await getContractInstance<VotingTokenEthers>("VotingToken");
  const defaultBond = await proposer.bond();
  const allowance = await votingToken.allowance(await signer.getAddress(), proposer.address);
  if (allowance.lt(defaultBond)) {
    process.stdout.write("Approving proposer bond...");
    const approveTx = await votingToken.connect(signer).approve(proposer.address, defaultBond);
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`Approving proposer bond txn: ${approveTx.hash}...`);
    await approveTx.wait();
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`Approved proposer bond txn: ${approveTx.hash}\n`);
  }
};

export const submitAdminProposal = async (
  signer: Signer,
  adminProposalTransactions: AdminProposalTransaction[],
  proposalExplanation: string
): Promise<void> => {
  process.stdout.write(`Submitting proposal for: ${proposalExplanation}...`);
  const proposalTx = await (await getContractInstance<ProposerV2Ethers>("ProposerV2"))
    .connect(signer)
    .propose(adminProposalTransactions, ethersUtils.toUtf8Bytes(proposalExplanation));
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  process.stdout.write(`Submitting proposal for: ${proposalExplanation}, txn: ${proposalTx.hash}...`);
  await proposalTx.wait();
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  process.stdout.write(`Submitted proposal for: ${proposalExplanation}, txn: ${proposalTx.hash}\n`);

  console.log("Proposal done!🎉");
  console.log("\nProposal data:\n", proposalTx.data);
};

export const getProposalToExecute = async (governorV2: GovernorV2Ethers): Promise<ProposalToExecute> => {
  let proposalNumber = Number(process.env.PROPOSAL_NUMBER);
  if (!Number.isInteger(proposalNumber)) {
    proposalNumber = (await governorV2.numProposals()).toNumber() - 1;
    if (proposalNumber < 0) throw new Error("No proposals found");
  }

  // Get the first unexecuted transaction index and the last one.
  const proposal = await governorV2.getProposal(proposalNumber);
  const fromTransactionIndex = proposal.transactions.findIndex((tx) => tx.to !== ethersConstants.AddressZero);
  if (fromTransactionIndex < 0) throw new Error(`No transactions to execute found in proposal ${proposalNumber}`);
  const toTransactionIndex = proposal.transactions.length - 1;

  return { proposalNumber, fromTransactionIndex, toTransactionIndex };
};

export const executeProposal = async (
  signer: Signer,
  governorV2: GovernorV2Ethers,
  proposal: ProposalToExecute
): Promise<TransactionReceipt> => {
  const transactionCount = proposal.toTransactionIndex - proposal.fromTransactionIndex + 1;
  const executeCalls = await Promise.all(
    Array.from({ length: transactionCount }, async (_, i) => {
      const executeCall = await governorV2.populateTransaction.executeProposal(
        proposal.proposalNumber,
        proposal.fromTransactionIndex + i
      );
      if (!executeCall.data) throw new Error("executeCall.data is undefined");
      return executeCall.data;
    })
  );
  process.stdout.write(`Executing ${transactionCount} transactions in proposal ${proposal.proposalNumber}...`);
  const executeTx = await governorV2.connect(signer).multicall(executeCalls);
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  process.stdout.write(
    `Executing ${transactionCount} transactions in proposal ${proposal.proposalNumber}, txn: ${executeTx.hash}...`
  );
  const txReceipt = await executeTx.wait();
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  process.stdout.write(
    `Executed ${transactionCount} transactions in proposal ${proposal.proposalNumber}, txn: ${executeTx.hash}\n`
  );
  return txReceipt;
};

// Get the transaction receipt of the executed admin transaction. If L1_EXECUTE_TX is not set, it will also execute the
// proposal using PROPOSAL_NUMBER or the last proposal if not set.
export const getL1ExecuteProposalReceipt = async (l1Signer: Signer): Promise<TransactionReceipt> => {
  const executeTx = process.env.L1_EXECUTE_TX;
  if (executeTx) {
    const txReceipt = await hre.ethers.provider.getTransactionReceipt(executeTx);
    return txReceipt || Promise.reject(new Error(`Transaction ${executeTx} not found`));
  } else {
    const governorV2 = await getContractInstance<GovernorV2Ethers>("GovernorV2");
    const proposalToExecute = await getProposalToExecute(governorV2);
    return await executeProposal(l1Signer, governorV2, proposalToExecute);
  }
};

export const getImpersonatedSigner = async (
  provider: JsonRpcProvider,
  signerAddress: string,
  balance?: number
): Promise<JsonRpcSigner> => {
  await provider.send("hardhat_impersonateAccount", [signerAddress]);
  if (balance) {
    await provider.send("hardhat_setBalance", [
      signerAddress,
      ethersUtils.parseEther(balance.toString()).toHexString(),
    ]);
  }
  return provider.getSigner(signerAddress);
};

export const getJsonRpcProvider = (networkName: SupportedNetwork): JsonRpcProvider => {
  const chainId = networksNumber[networkName];
  const nodeUrl = process.env[String("NODE_URL_" + chainId)];
  if (!nodeUrl) throw new Error("NODE_URL_" + chainId + " environment variable not set");
  return new JsonRpcProvider(nodeUrl);
};
