import { utils as ethersUtils, PopulatedTransaction, ContractTransaction, ContractReceipt } from "ethers";
import { TransactionResponse, TransactionReceipt } from "@ethersproject/abstract-provider";
import { Signer } from "@ethersproject/abstract-signer";
import type { Contract } from "@ethersproject/contracts";
import { ErrorCode } from "@ethersproject/logger";
import { isRecordStringUnknown } from "./ObjectUtils";

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

// This module only uses the block number from the transaction receipt.
type TxReceiptWithBlockNumber = Pick<TransactionReceipt, "blockNumber">;

// Expected Ethers error structure as thrown when waiting for the sent transaction.
interface EthersV5WaitTransactionError extends EthersV5Error {
  receipt: TxReceiptWithBlockNumber;
}

// Type helper to add revert data to the Ethers error type.
type WithRevertData<T> = T & { revertData: string };

// Extended Ethers error adding the revert data for easier handling in the caller.
export type EthersTxRunnerError =
  | WithRevertData<EthersV5EstimateGasError>
  | WithRevertData<EthersV5WaitTransactionError>;

// Type helper to determine the return type of the wait() method based on the transaction type.
type WaitReturn<T> = T extends ContractTransaction ? ContractReceipt : TransactionReceipt;

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
    ethersUtils.isHexString(error.error.error.data)
  );
}

// Type guard that can be used by the caller to handle revert data in the Ethers transaction runner errors.
export function isEthersTxRunnerError(error: unknown): error is EthersTxRunnerError {
  return isErrorRecord(error) && ethersUtils.isHexString(error.revertData);
}

// Type guard for transaction receipt thrown when sending a transaction. This only checks the blockNumber that is needed
// for the replay when extracting the revert data.
function isEthersTransactionReceipt(receipt: unknown): receipt is TxReceiptWithBlockNumber {
  return isRecordStringUnknown(receipt) && typeof receipt.blockNumber === "number";
}

// Type guard for Ethers wait sent transaction error. This checks the error code, the transaction and receipt structures
// that are needed for the replay when extracting the revert data.
function isEthersWaitTransactionError(error: unknown): error is EthersV5WaitTransactionError {
  return isEthersError(error) && error.code === ErrorCode.CALL_EXCEPTION && isEthersTransactionReceipt(error.receipt);
}

// Helper function to add revert data to thrown error in the Ethers transaction wait() method. It overrides the original
// wait() method and adds the logic to replay the transaction to extract the revert data if the transaction fails.
function overrideTxWait<T extends TransactionResponse | ContractTransaction>(tx: T, signer: Signer): T {
  const originalWait = tx.wait.bind(tx);
  tx.wait = async (confirmations?: number): Promise<WaitReturn<T>> => {
    try {
      // Call the original wait() method to get the receipt.
      return await originalWait(confirmations);
    } catch (error) {
      // The transaction could still have failed when mined due to changed state after the gas estimation.
      if (isEthersWaitTransactionError(error)) {
        // Try to replay the transaction to extract the revert data. Note that this will not work if the reverting state
        // has changed between the transaction index and the top of the block. For more precise revert data, the call
        // tracing should be used instead.
        let revertData: string;
        const { to, from, gasLimit, data, value, accessList } = tx;
        const replayTx = { to, from, gasLimit, data, value, accessList };
        try {
          // Note that Ethers v5 does not throw an error on call when it reverts and just returns the revert data.
          // This might be different in Ethers v6, so this logic might need to be adjusted if it is migrated to v6.
          revertData = await signer.call(replayTx, error.receipt.blockNumber);
        } catch {
          // If the call fails, we cannot extract the revert data, so just throw the original wait error.
          throw error;
        }
        // Add revert data to the error (mutate the original error, same as done in Ethers v5).
        (error as EthersTxRunnerError).revertData = revertData;
        throw error;
      }
      // This might be any other error thrown by Ethers, so just rethrow it.
      throw error;
    }
  };

  return tx;
}

// Helper function to add revert data on gas estimation error. It mutates the original error to add the revert data.
async function estimateTxGasLimit(
  signer: Signer,
  originalTx: PopulatedTransaction,
  gasLimitMultiplier?: number
): Promise<PopulatedTransaction> {
  // Copy the transaction as it will be modified on gas estimation.
  const returnedTx = { ...originalTx };

  // Estimate gas limit if not provided.
  if (!originalTx.gasLimit) {
    try {
      returnedTx.gasLimit = await signer.estimateGas(returnedTx);
    } catch (error) {
      // Add revert data if it is gas estimation error (mutate the original error, same as done in Ethers v5).
      if (isEthersEstimateGasError(error)) {
        (error as EthersTxRunnerError).revertData = error.error.error.data;
        throw error;
      }
      // If the error is not related to gas estimation, rethrow it.
      throw error;
    }

    // Potentially apply gas limit multiplier only when the gas limit was not explicitly set.
    if (gasLimitMultiplier) returnedTx.gasLimit = returnedTx.gasLimit.mul(gasLimitMultiplier).div(100);
  }

  return returnedTx;
}

/**
 * Send a transaction with Ethers v5 while preserving native error semantics and enriching failures with revert data.
 *
 * Behavior:
 * - If `originalTx.gasLimit` is missing, estimates it via `signer.estimateGas(originalTx)`.
 * - On `UNPREDICTABLE_GAS_LIMIT`, rethrows the same error object and annotates it with `error.revertData` (hex).
 * - Optionally applies a gas limit multiplier (percentage), e.g. `110` => +10%.
 * - Sends via `signer.sendTransaction(...)` and returns the resulting `TransactionResponse`.
 * - The returned `tx.wait()` is overridden so that if the tx **mines and reverts** (ethers throws `CALL_EXCEPTION`),
 *   the function replays the call at `receipt.blockNumber` to recover the revert payload and annotates the thrown
 *   error with `error.revertData` before rethrowing the **same** error instance.
 * Note: Enhanced error data would only work for signers backed by JsonRpcProvider, as it relies on the specific
 *   placement of the revert data in the thrown error structure. Other providers may not support this.
 *
 * @param signer               Ethers v5 Signer that will estimate and send the transaction.
 * @param originalTx           Populated transaction (may omit `gasLimit`; `from` is inferred from the signer if absent).
 * @param gasLimitMultiplier   Optional percentage multiplier for the estimated gas limit (e.g., 110 = +10%).
 * @returns                    A `TransactionResponse` whose `wait()` may throw `CALL_EXCEPTION` with `error.revertData`
 *                             on failure.
 */
export async function runEthersTransaction(
  signer: Signer,
  originalTx: PopulatedTransaction,
  gasLimitMultiplier?: number
): Promise<TransactionResponse> {
  // Estimate the gas limit adding the revert data on failure.
  const submittedTx = await estimateTxGasLimit(signer, originalTx, gasLimitMultiplier);

  // Submit the transaction, any Ethers errors would be bubbled up to the caller.
  const tx = await signer.sendTransaction(submittedTx);

  // Override tx.wait() adding revert data on failure.
  return overrideTxWait(tx, signer);
}

/**
 * Send a **contract** transaction with Ethers v5 while preserving native error semantics, enriching failures with
 * revert data and enabling decoded events.
 *
 * Behavior:
 * - If `originalTx.gasLimit` is missing, estimates it via `signer.estimateGas(originalTx)`.
 * - On `UNPREDICTABLE_GAS_LIMIT`, rethrows the same error object and annotates it with `error.revertData` (hex).
 * - Optionally applies a gas limit multiplier (percentage), e.g. `110` => +10%.
 * - Validates that `originalTx.to` matches `contract.address` and that `data` is present.
 * - Re-encodes and **dispatches through the contract ABI** (`contract.functions[name](...args, overrides)`), so that
 *   `tx.wait()` resolves to a **ContractReceipt with decoded `events`**.
 * - The returned `tx.wait()` is overridden so that if the tx **mines and reverts** (ethers throws `CALL_EXCEPTION`),
 *   the function replays the call at `receipt.blockNumber` to recover the revert payload and annotates the thrown
 *   error with `error.revertData` before rethrowing the **same** error instance.
 * Note: Enhanced error data would only work for contracts backed by JsonRpcProvider, as it relies on the specific
 *   placement of the revert data in the thrown error structure. Other providers may not support this.
 *
 * @param contract             Ethers v5 Contract instance (must have a signer attached).
 * @param originalTx           Populated transaction targeting `contract.address` with encoded `data`.
 * @param gasLimitMultiplier   Optional percentage multiplier for the estimated gas limit (e.g., 110 = +10%).
 * @returns                    A `ContractTransaction` whose `wait()` returns a `ContractReceipt` with decoded events,
 *                             or throws `CALL_EXCEPTION` with `error.revertData` on failure.
 */
export async function runEthersContractTransaction(
  contract: Contract,
  originalTx: PopulatedTransaction,
  gasLimitMultiplier?: number
): Promise<ContractTransaction> {
  const { signer } = contract;
  if (!Signer.isSigner(signer)) throw new Error("Contract has invalid signer");

  // Estimate the gas limit adding the revert data on failure.
  const submittedTx = await estimateTxGasLimit(signer, originalTx, gasLimitMultiplier);

  // Validate this can be run as a contract transaction.
  if (submittedTx.to?.toLowerCase() !== contract.address.toLowerCase()) {
    throw new Error(`Transaction 'to' address ${submittedTx.to} does not match contract address ${contract.address}.`);
  }
  if (submittedTx.data === undefined || submittedTx.data === "0x") {
    throw new Error("Transaction 'data' is undefined or empty, cannot run contract transaction.");
  }

  // Extract transaction overrides and parse the transaction data.
  const overrides = (({ to: _to, from: _from, data: _data, chainId: _chainId, ...overrides }) => overrides)(
    submittedTx
  );
  const parsed = contract.interface.parseTransaction({ data: submittedTx.data });

  // Submit the transaction re-encoding with contract interface and applying overrides.
  const tx = (await contract.functions[parsed.signature](...parsed.args, overrides)) as ContractTransaction;

  // Override tx.wait() adding revert data on failure.
  return overrideTxWait(tx, signer);
}
