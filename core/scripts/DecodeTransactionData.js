// This script allows you to decode a transaction data blob revealing the method that the transaction is calling and
// the parameters.
// Example:
// $(npm bin)/truffle exec --network test ./scripts/DecodeTransactionData.js --data 0x10a7e2014554482f55534400000000000000000000000000000000000000000000000000

const { getAbiDecoder } = require("../../common/AbiUtils.js");

const argv = require("minimist")(process.argv.slice(), { string: ["data"] });

function run(data) {
  return getAbiDecoder().decodeMethod(data);
}

const decodeTransactionData = async function(callback) {
  try {
    if (!argv.data) {
      callback("You must provide the transaction data using the --data argument, e.g. --data 0x1234");
    } else if (!argv.data.startsWith("0x")) {
      callback("The --data argument must be a hex string starting with `0x`, e.g. --data 0x1234");
    }

    const txnObj = run(argv.data);

    if (!txnObj) {
      console.log(
        "Could not identify the method that this transaction is calling.",
        "Are you sure it corresponds to a contract in the UMAprotocol/protocol repository?"
      );
    } else {
      // Pretty print.
      console.log("Your decoded transaction information:");
      console.log(JSON.stringify(txnObj, null, 4));
    }
  } catch (e) {
    // Forces the script to return a nonzero error code so failure can be detected in bash.
    callback(e);
    return;
  }

  callback();
};

decodeTransactionData.run = run;
module.exports = decodeTransactionData;
