import { ethers, PopulatedTransaction, Transaction, BigNumber } from "ethers";
import type { BaseContract } from "ethers";
import { Provider } from "@ethersproject/abstract-provider";
import { Signer } from "@ethersproject/abstract-signer";
import { ErrorCode } from "@ethersproject/logger";
import { TransactionReceipt } from "@ethersproject/abstract-provider";
import { AccessList } from "@ethersproject/transactions";
import { isRecordStringUnknown } from "./";

// Helper interface for Ethers error codes.
interface EthersV5Error extends Error {
  code: ErrorCode;
}

// Expected Ethers error structure as thrown at gas estimation. Note that this could be nested one level deeper when
// the signer populates the transaction with estimated gas limit before sending it, but this module always sets the
// gas limit explicitly when sending, so we can safely assume the structure below.
interface EthersV5EstimateGasError extends EthersV5Error {
  error: {
    error: {
      data: string;
    };
  };
}

// This module only uses selected properties from the thrown transaction when replaying it to extract the revert data.
type ReplayTransaction = Pick<Transaction, "to" | "from" | "gasLimit" | "data" | "value" | "accessList">;

// This module only uses the block number from the transaction receipt.
type TxReceiptWithBlockNumber = Pick<TransactionReceipt, "blockNumber">;

// Expected Ethers error structure as thrown when waiting for sent a transaction with a provided gas limit.
interface EthersV5WaitTransactionError extends EthersV5Error {
  transaction: ReplayTransaction;
  receipt: TxReceiptWithBlockNumber;
}

// Type helper to add revert data and where the error was thrown to the Ethers error type.
type WithRevertData<T, At extends "estimateGas" | "waitTransaction"> = T & { revertData: string; thrownAt: At };

// Extended Ethers error adding where the error was thrown and revert data for easier handling in the caller.
export type EthersTxRunnerError =
  | WithRevertData<EthersV5EstimateGasError, "estimateGas">
  | WithRevertData<EthersV5WaitTransactionError, "waitTransaction">;

// Every Error should be a Record, so this type guard helps to check on individual properties of the Error object.
function isErrorRecord(error: unknown): error is Error & Record<PropertyKey, unknown> {
  return error instanceof Error;
}

// Type guard for known Ethers error codes.
function isEthersErrorCode(code: unknown): code is ErrorCode {
  return typeof code === "string" && Object.values(ErrorCode).includes(code as ErrorCode);
}

// Every Ethers error should be a Record, so this type guard helps to check on individual properties of the Ethers error.
function isEthersError(error: unknown): error is EthersV5Error & Record<PropertyKey, unknown> {
  return isErrorRecord(error) && isEthersErrorCode(error.code);
}

// Type guard for potential Ethers error to get revert data when gas estimation fails.
function isEthersEstimateGasError(error: unknown): error is EthersV5EstimateGasError {
  return (
    isEthersError(error) &&
    error.code === ErrorCode.UNPREDICTABLE_GAS_LIMIT &&
    isRecordStringUnknown(error.error) &&
    isRecordStringUnknown(error.error.error) &&
    ethers.utils.isHexString(error.error.error.data)
  );
}

// Type guard for AccessList, used when the thrown transaction included an access list.
function isAccessList(accessList: unknown): accessList is AccessList {
  return (
    Array.isArray(accessList) &&
    accessList.every(
      (item) =>
        isRecordStringUnknown(item) &&
        typeof item.address === "string" &&
        ethers.utils.isAddress(item.address) &&
        Array.isArray(item.storageKeys) &&
        item.storageKeys.every((key) => typeof key === "string" && ethers.utils.isHexString(key))
    )
  );
}

// Type guard for transaction thrown when sending a transaction. This only checks properties that are needed for the
// replay when extracting the revert data.
function isEthersTransaction(transaction: unknown): transaction is ReplayTransaction {
  return (
    isRecordStringUnknown(transaction) &&
    typeof transaction.to === "string" &&
    ethers.utils.isAddress(transaction.to) &&
    typeof transaction.from === "string" &&
    ethers.utils.isAddress(transaction.from) &&
    BigNumber.isBigNumber(transaction.gasLimit) &&
    ethers.utils.isHexString(transaction.data) &&
    BigNumber.isBigNumber(transaction.value) &&
    ("accessList" in transaction ? isAccessList(transaction.accessList) : true)
  );
}

// Type guard for transaction receipt thrown when sending a transaction. This only checks the blockNumber that is needed
// for the replay when extracting the revert data.
function isEthersTransactionReceipt(receipt: unknown): receipt is TxReceiptWithBlockNumber {
  return isRecordStringUnknown(receipt) && typeof receipt.blockNumber === "number";
}

// Type guard for Ethers wait sent transaction error. This checks the error code, the transaction and receipt structures
// that are needed for the replay when extracting the revert data.
function isEthersWaitTransactionError(error: unknown): error is EthersV5WaitTransactionError {
  return (
    isEthersError(error) &&
    error.code === ErrorCode.CALL_EXCEPTION &&
    isEthersTransaction(error.transaction) &&
    isEthersTransactionReceipt(error.receipt)
  );
}

// Helper to run an Ethers transaction with the provided contract and transaction parameters. It estimates the gas limit
// if not provided, applies a gas limit multiplier if specified, and sends the transaction. If the transaction fails, it
// attempts to extract the revert data by replaying the transaction. The function throws an error with additional
// information about where the error occurred and the revert data if available.
export async function runEthersTransaction(
  contract: BaseContract,
  originalTx: PopulatedTransaction,
  gasLimitMultiplier?: number
): Promise<TransactionReceipt> {
  if (!Signer.isSigner(contract.signer)) throw new Error("Contract has invalid signer");
  if (!Provider.isProvider(contract.provider)) throw new Error("Contract has invalid provider");

  // Copy the transaction with required from and to addresses.
  const from = originalTx.from ?? (await contract.signer.getAddress());
  const to = originalTx.to ?? contract.address;
  const submittedTx = { ...originalTx, from, to };

  // Estimate gas limit if not provided.
  if (!originalTx.gasLimit) {
    try {
      submittedTx.gasLimit = await contract.provider.estimateGas(submittedTx);
    } catch (error) {
      // Add revert data if it is gas estimation error (mutate the original error, same as done in Ethers v5).
      if (isEthersEstimateGasError(error)) {
        (error as EthersTxRunnerError).thrownAt = "estimateGas";
        (error as EthersTxRunnerError).revertData = error.error.error.data;
        throw error;
      }
      // If the error is not related to gas estimation, rethrow it.
      throw error;
    }

    // Potentially apply gas limit multiplier only when the gas limit was not explicitly set.
    if (gasLimitMultiplier) submittedTx.gasLimit = submittedTx.gasLimit.mul(gasLimitMultiplier).div(100);
  }

  // Send the transaction returning the receipt on success or adding revert data on failure.
  try {
    return await (await contract.signer.sendTransaction(submittedTx)).wait();
  } catch (error) {
    // The transaction could still fail when submitted due to changed state after the gas estimation.
    if (isEthersWaitTransactionError(error)) {
      // Try to replay the transaction to extract the revert data. Note that this will not work if the reverting state
      // has changed between the transaction index and the top of the block. For more precise revert data, the call
      // tracing should be used instead.
      const replayTx: ReplayTransaction = {
        to: error.transaction.to,
        from: error.transaction.from,
        gasLimit: error.transaction.gasLimit,
        data: error.transaction.data,
        value: error.transaction.value,
        accessList: error.transaction.accessList,
      };

      let revertData: string;
      try {
        // Note that Ethers v5 does not throw an error on call when it reverts and just returns the revert data.
        // This might be different in Ethers v6, so this logic might need to be adjusted if it is migrated to v6.
        revertData = await contract.provider.call(replayTx, error.receipt.blockNumber);
      } catch {
        // If the call fails, we cannot extract the revert data, so just throw the original error.
        throw error;
      }
      // Add revert data to the error (mutate the original error, same as done in Ethers v5).
      (error as EthersTxRunnerError).thrownAt = "waitTransaction";
      (error as EthersTxRunnerError).revertData = revertData;
      throw error;
    }
    // This might be any other error thrown by Ethers, so just rethrow it.
    throw error;
  }
}
