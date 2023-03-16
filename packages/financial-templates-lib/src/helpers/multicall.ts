// Provides convenience methods for interacting with deployed Multicall contract on network.
import { getAbi } from "@uma/contracts-node";
import type { MulticallWeb3 } from "@uma/contracts-node";
import { TransactionDataDecoder } from "./AbiUtils";
import assert from "assert";
import type Web3 from "web3";
import type { TransactionReceipt } from "web3-core";

// Decode `returnData` into Javascript type using known contract ABI informtaion
// from the `callData` originally used to produce `returnData`.
function _decodeOutput(callData: string, returnData: string, web3: Web3) {
  const methodAbi = TransactionDataDecoder.getInstance().abiDecoder.getMethodIDs()[callData.slice(2, 10)];
  return web3.eth.abi.decodeParameters(methodAbi.outputs, returnData);
}

interface Transaction {
  target: string;
  callData: string;
}

// Simulate submitting a batch of `transactions` to the multicall contact
// and return an array of decoded, simulated output values.
export const aggregateTransactionsAndCall = async (
  multicallAddress: string,
  web3: Web3,
  transactions: Transaction[],
  blockNumber?: number
): Promise<{ [key: string]: any }[]> => {
  const multicallContract = (new web3.eth.Contract(getAbi("Multicall"), multicallAddress) as unknown) as MulticallWeb3;
  for (let i = 0; i < transactions.length; i++) {
    assert(
      transactions[i].target && transactions[i].callData,
      "transaction expected in form {target: address, callData: bytes}"
    );
  }

  // Decode return data, which is an array of the same length as `transactions`:
  const returnData = (
    await multicallContract.methods
      .aggregate((transactions as unknown) as [string, string][]) // TODO: types in typechain erroneously don't have named params.
      .call(undefined, blockNumber)
  ).returnData;
  return returnData.map((data, i) => _decodeOutput(transactions[i].callData, data, web3));
};

export const aggregateTransactionsAndSend = async (
  multicallAddress: string,
  web3: Web3,
  transactions: Transaction[],
  txnConfigObj: any
): Promise<TransactionReceipt> => {
  const multicallContract = (new web3.eth.Contract(getAbi("Multicall"), multicallAddress) as unknown) as MulticallWeb3;
  for (let i = 0; i < transactions.length; i++) {
    assert(
      transactions[i].target && transactions[i].callData,
      "transaction expected in form {target: address, callData: bytes}"
    );
  }
  return await multicallContract.methods.aggregate((transactions as unknown) as [string, string][]).send(txnConfigObj);
};

export const multicallAddressMap: { [network: string]: { multicall: string } } = {
  mainnet: { multicall: "0xeefba1e63905ef1d7acba5a8513c70307c1ce441" },
  kovan: { multicall: "0x2cc8688c5f75e365aaeeb4ea8d6a480405a48d2a" },
  rinkeby: { multicall: "0x42ad527de7d4e9d9d011ac45b31d8551f8fe9821" },
  goerli: { multicall: "0x77dca2c955b15e9de4dbbcf1246b4b85b651e50e" },
  xdai: { multicall: "0xb5b692a88bdfc81ca69dcb1d924f59f0413a602a" },
};
