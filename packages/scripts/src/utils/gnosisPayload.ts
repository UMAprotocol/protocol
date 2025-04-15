import { utils as ethersUtils, constants as ethersConstants, BigNumber } from "ethers";
import { JsonRpcProvider } from "@ethersproject/providers";
import { MetaTransactionData, OperationType, SafeTransactionData, SafeVersion } from "@safe-global/types-kit";
import { getMultiSendCallOnlyDeployment } from "@safe-global/safe-deployments";
import { GnosisSafeL2130__factory, MultiSendCallOnly130__factory, GnosisSafeL2130 } from "../../build/typechain";
import { getImpersonatedSigner } from "../admin-proposals/common";
export interface GnosisPayload {
  version: string;
  chainId: string;
  createdAt: number;
  meta: {
    name: string;
    description: string;
    txBuilderVersion: string;
    createdFromSafeAddress: string;
    createdFromOwnerAddress: string;
    checksum: string;
  };
  transactions: GnosisTransaction[];
}

export interface GnosisTransaction {
  to: string;
  value: string;
  contractMethod: { inputs: { internalType: string; name: string; type: string }[]; name: string; payable: boolean };
  contractInputsValues: { [key: string]: string };
}

export function baseSafePayload(
  chainId: number,
  name: string,
  description: string,
  createdFromSafeAddress: string
): GnosisPayload {
  return {
    version: "1.0",
    chainId: chainId.toString(),
    createdAt: Date.now(),
    meta: {
      name,
      description,
      txBuilderVersion: "1.13.2",
      createdFromSafeAddress,
      createdFromOwnerAddress: "",
      checksum: "",
    },
    transactions: [],
  };
}

export function appendTxToSafePayload(
  payload: any,
  to: string,
  contractMethod: any,
  contractInputsValues: any
): GnosisPayload {
  payload.transactions.push({
    to,
    value: "0",
    data: null,
    contractMethod,
    contractInputsValues,
  });
  return payload;
}

export function getContractMethod(abi: any[], name: string): any {
  const method = abi.find((fragment) => fragment.name === name && fragment.type === "function");
  if (!method) {
    throw new Error(`Method ${name} not found in ABI`);
  }
  return method;
}

function encodeSafeTransactionData(transaction: GnosisTransaction): string {
  // Get input values in the same order as in the contract method.
  const inputValues = transaction.contractMethod.inputs.map((input) => {
    const value = transaction.contractInputsValues[input.name];
    if (value === undefined) {
      throw new Error(`Missing value for input "${input.name}"`);
    }
    return value;
  });

  const iface = new ethersUtils.Interface([transaction.contractMethod]);
  return iface.encodeFunctionData(transaction.contractMethod.name, inputValues);
}

function createMultiSendTransactionMeta(safePayload: GnosisPayload, version: SafeVersion): MetaTransactionData {
  const multiSendCallOnlyDeployment = getMultiSendCallOnlyDeployment({ version });
  if (!multiSendCallOnlyDeployment) throw new Error("MultiSendCallOnlyDeployment not found!");
  const multiSendCallOnlyAddress =
    multiSendCallOnlyDeployment.networkAddresses[safePayload.chainId] || multiSendCallOnlyDeployment.defaultAddress;

  const encodedTransactions = ethersUtils.hexConcat(
    safePayload.transactions.map((transaction) => {
      const transactionData = encodeSafeTransactionData(transaction);
      const dataLength = ethersUtils.arrayify(transactionData).length;
      return ethersUtils.solidityPack(
        ["uint8", "address", "uint256", "uint256", "bytes"],
        [0, transaction.to, transaction.value, dataLength, transactionData]
      );
    })
  );

  // We had to pick a static interface, but the methods used should be also compatible for other versions than 1.3.0
  const multiSendCallOnlyIface = MultiSendCallOnly130__factory.createInterface();
  const calldata = multiSendCallOnlyIface.encodeFunctionData("multiSend", [encodedTransactions]);

  return {
    to: multiSendCallOnlyAddress,
    value: "0",
    data: calldata,
    operation: OperationType.DelegateCall,
  };
}

function createSingleTransactionMeta(transaction: GnosisTransaction): MetaTransactionData {
  return {
    to: transaction.to,
    value: transaction.value,
    data: encodeSafeTransactionData(transaction),
    operation: OperationType.Call,
  };
}

async function createSafeTransactionData(
  meta: MetaTransactionData,
  safe: GnosisSafeL2130
): Promise<SafeTransactionData> {
  const nonce = await safe.nonce();

  return {
    to: meta.to,
    value: meta.value,
    data: meta.data,
    operation: meta.operation || OperationType.Call,
    safeTxGas: "0",
    baseGas: "0",
    gasPrice: "0",
    gasToken: ethersConstants.AddressZero,
    refundReceiver: ethersConstants.AddressZero,
    nonce: nonce.toNumber(),
  };
}

// This method will attempt to impersonate the signers. The caller is responsible to check that the provider supports it.
async function approveTransaction(
  provider: JsonRpcProvider,
  safeTransactionData: SafeTransactionData,
  safe: GnosisSafeL2130,
  owners: string[],
  threshold: number
): Promise<string> {
  const transactionHash = await safe.getTransactionHash(
    safeTransactionData.to,
    safeTransactionData.value,
    safeTransactionData.data,
    safeTransactionData.operation,
    safeTransactionData.safeTxGas,
    safeTransactionData.baseGas,
    safeTransactionData.gasPrice,
    safeTransactionData.gasToken,
    safeTransactionData.refundReceiver,
    safeTransactionData.nonce
  );

  let signatures = "0x";

  for (const owner of owners.slice(0, threshold)) {
    const signer = await getImpersonatedSigner(provider, owner, 1);

    process.stdout.write(`Approving transaction from ${owner}...`);
    const tx = await safe.connect(signer).approveHash(transactionHash);
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`Approving transaction from ${owner}, txn: ${tx.hash}...`);
    await tx.wait();
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(`Approved transaction from ${owner}, txn: ${tx.hash}\n`);

    // v is 1 for approved hash signatures, r is approver's address padded to 32 bytes, and s is not checked.
    const v = 1;
    const r = ethersUtils.hexZeroPad(owner, 32);
    const s = ethersConstants.HashZero;
    const signature = ethersUtils.solidityPack(["bytes32", "bytes32", "uint8"], [r, s, v]);

    // Concatenate the signatures
    signatures = ethersUtils.hexConcat([signatures, signature]);
  }

  return signatures;
}

// This method will attempt to impersonate the signer. The caller is responsible to check that the provider supports it.
async function executeTransaction(
  provider: JsonRpcProvider,
  safeTransactionData: SafeTransactionData,
  safe: GnosisSafeL2130,
  senderAddress: string,
  signatures: string
): Promise<void> {
  const signer = await getImpersonatedSigner(provider, senderAddress, 1);

  process.stdout.write(`Executing approved transaction from ${senderAddress}...`);
  const tx = await safe
    .connect(signer)
    .execTransaction(
      safeTransactionData.to,
      safeTransactionData.value,
      safeTransactionData.data,
      safeTransactionData.operation,
      safeTransactionData.safeTxGas,
      safeTransactionData.baseGas,
      safeTransactionData.gasPrice,
      safeTransactionData.gasToken,
      safeTransactionData.refundReceiver,
      signatures
    );
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  process.stdout.write(`Executing approved transaction from ${senderAddress}, txn: ${tx.hash}...`);
  await tx.wait();
  process.stdout.clearLine(0);
  process.stdout.cursorTo(0);
  process.stdout.write(`Executed approved transaction from ${senderAddress}, txn: ${tx.hash}\n`);
}

// This method will attempt to impersonate the signers. The caller is responsible to check that the provider supports it.
export async function simulateSafePayload(
  provider: JsonRpcProvider,
  payload: GnosisPayload,
  version: SafeVersion
): Promise<void> {
  const safeTransaction =
    payload.transactions.length > 1
      ? createMultiSendTransactionMeta(payload, version)
      : createSingleTransactionMeta(payload.transactions[0]);

  // We had to pick a static interface, but the methods used should be also compatible for other versions than 1.3.0
  const safe = GnosisSafeL2130__factory.connect(payload.meta.createdFromSafeAddress, provider);
  const threshold = await safe.getThreshold();
  const owners = await safe.getOwners();
  const sortedOwners = owners.slice().sort((a, b) => (BigNumber.from(a).lt(BigNumber.from(b)) ? -1 : 1));

  // Populate the transaction data using the latest nonce.
  const safeTransactionData = await createSafeTransactionData(safeTransaction, safe);

  // Approve transaction hash by the first required owners.
  const signatures = await approveTransaction(provider, safeTransactionData, safe, sortedOwners, threshold.toNumber());

  // Execute the transaction. We use the first owner, but any sender can do it as all required owners have approved it.
  await executeTransaction(provider, safeTransactionData, safe, sortedOwners[0], signatures);
}
