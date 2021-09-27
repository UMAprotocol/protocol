#!/usr/bin/env node

// This script allows you to decode a transaction data blob revealing the method that the transaction is calling and
// the parameters.
// Example:
// ./src/DecodeTransactionData.js --data 0x10a7e2014554482f55534400000000000000000000000000000000000000000000000000

const { TransactionDataDecoder } = require("@uma/financial-templates-lib");

const argv = require("minimist")(process.argv.slice(), { string: ["data"] });

function _decodeData(data) {
  return TransactionDataDecoder.getInstance().decodeTransaction(data);
}

const _printTransactionDataRecursive = function (txnObj) {
  // If transaction is a proposal then recursively print out its transactions
  if (txnObj.name === "propose" && txnObj.params.transactions.length > 0) {
    console.group(`Transaction is a proposal containing ${txnObj.params.transactions.length} transactions:`);
    txnObj.params.transactions.forEach((_txn) => {
      const decodedTxnData = _decodeData(_txn.data);

      // If decodedTxnData itself has a `data` key, then decode it:
      if (decodedTxnData.params.data) {
        const decodedParamData = _decodeData(decodedTxnData.params.data);
        decodedTxnData.params.data = decodedParamData;
      }
      _printTransactionDataRecursive({ ...decodedTxnData, to: _txn.to, value: _txn.value });
    });
    console.groupEnd();
    // Multicall
  } else if (txnObj.name === "aggregate" && txnObj?.params?.calls?.length > 0) {
    console.group(`Transaction is a multicall transaction containing ${txnObj.params.calls.length} transactions:`);
    txnObj.params.calls.forEach((_call) => {
      const decodedTxnData = _decodeData(_call.callData);
      _printTransactionDataRecursive({ ...decodedTxnData, to: _call.target, value: "0" });
    });
    console.groupEnd();
  } else {
    // Pretty print:
    console.log(`${JSON.stringify(txnObj, null, 4)}`);
  }
};

function main() {
  if (!argv.data) {
    throw new Error("You must provide the transaction data using the --data argument, e.g. --data 0x1234");
  } else if (!argv.data.startsWith("0x")) {
    throw new Error("The --data argument must be a hex string starting with `0x`, e.g. --data 0x1234");
  }

  const txnData = _decodeData(argv.data);

  if (!txnData) {
    console.log(
      "Could not identify the method that this transaction is calling.",
      "Are you sure it corresponds to a contract in the UMAprotocol/protocol repository?"
    );
  } else {
    console.log("Your decoded transaction information:");
    _printTransactionDataRecursive(txnData);
  }
}
if (require.main === module) {
  main();
} else {
  module.exports = _decodeData;
}
