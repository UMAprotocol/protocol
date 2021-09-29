// This library has two functions that it exports: getAllContracts() and getAbiDecoder().
//
// getAllContracts() returns an array of all JSON artifacts from the core/build/contracts directory.
//
// getAbiDecoder returns an abi decoder (see https://github.com/UMAprotocol/abi-decoder) object preloaded with the ABIs
// pulled from the core/build/contracts directory. Example usage:
// getAbiDecoder().decodeMethod(data); // This decodes the txn data into the function name and arguments.

import abiDecoder from "abi-decoder";
import { getContractNames, getAbi } from "@uma/contracts-node";
import type { BN } from "../types";

type AbiDecoder = typeof abiDecoder;

export class TransactionDataDecoder {
  private static instance: TransactionDataDecoder;
  public readonly abiDecoder: AbiDecoder;
  private constructor() {
    this.abiDecoder = abiDecoder;
    getContractNames().forEach((name) => this.abiDecoder.addABI(getAbi(name)));
  }

  public static getInstance(): TransactionDataDecoder {
    if (!TransactionDataDecoder.instance) {
      TransactionDataDecoder.instance = new TransactionDataDecoder();
    }

    return TransactionDataDecoder.instance;
  }

  public decodeTransaction(txData: string): { name: string; params: any } {
    return this.abiDecoder.decodeMethod(txData);
  }
}

interface Transaction {
  data?: string;
  to: string;
  value: string | BN;
}

export function decodeTransaction(transaction: Transaction): string {
  let returnValue = "";

  // Give to and value.
  returnValue += "To: " + transaction.to;
  returnValue += "\nValue (in Wei): " + transaction.value;

  if (!transaction.data || transaction.data.length === 0 || transaction.data === "0x") {
    // No data -> simple ETH send.
    returnValue += "\nTransaction is a simple ETH send (no data).";
  } else {
    // Loading the abi decoder is expensive, so do it only if called and cache it for repeated use.
    const decoder = TransactionDataDecoder.getInstance();

    // Txn data isn't empty -- attempt to decode.
    const decodedTxn = decoder.decodeTransaction(transaction.data);
    if (!decodedTxn) {
      // Cannot decode txn, just give the user the raw data.
      returnValue += "\nCannot decode transaction (does not match any UMA Protocol Signature).";
      returnValue += "\nRaw transaction data: " + transaction.data;
    } else {
      // Decode was successful -- pretty print the results.
      returnValue += "\nTransaction details:\n";
      returnValue += JSON.stringify(decodedTxn, null, 4);
    }
  }
  return returnValue;
}
