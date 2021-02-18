// This script allows you to decode a transaction data blob revealing the method that the transaction is calling and
// the parameters.
// Example:
// yarn truffle exec --network test ./scripts/DecodeTransactionData.js --data 0x10a7e2014554482f55534400000000000000000000000000000000000000000000000000

const { getAbiDecoder } = require("@uma/common");

const argv = require("minimist")(process.argv.slice(), { string: ["data"] });

function _decodeData(data) {
  return getAbiDecoder().decodeMethod(data);
}

const _printTransactionDataRecursive = function(txnObj) {
  // If transaction is a proposal then recursively print out its transactions
  if (txnObj.name === "propose" && txnObj.params.transactions.length > 0) {
    console.group(`Transaction is a proposal containing ${txnObj.params.transactions.length} transactions:`);
    txnObj.params.transactions.forEach(_txn => {
      const decodedTxnData = _decodeData(_txn.data);
      _printTransactionDataRecursive({ ...decodedTxnData, to: _txn.to, value: _txn.value });
    });
    console.groupEnd();
  } else {
    // Pretty print:
    console.log(`${JSON.stringify(txnObj, null, 4)}`);
  }
};

const decodeTransactionData = function(callback) {
  try {
    if (!argv.data) {
      callback("You must provide the transaction data using the --data argument, e.g. --data 0x1234");
    } else if (!argv.data.startsWith("0x")) {
      callback("The --data argument must be a hex string starting with `0x`, e.g. --data 0x1234");
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
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
};

decodeTransactionData.run = _decodeData;
module.exports = decodeTransactionData;
