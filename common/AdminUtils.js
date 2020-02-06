const abiDecoder = require("./AbiUtils.js").getAbiDecoder();

function decodeTransaction(transaction) {
  let returnValue = "";

  // Give to and value.
  returnValue += "To: " + transaction.to;
  returnValue += "\nValue (in Wei): " + transaction.value;

  if (!transaction.data || transaction.data.length === 0 || transaction.data === "0x") {
    // No data -> simple ETH send.
    returnValue += "\nTransaction is a simple ETH send (no data).";
  } else {
    // Txn data isn't empty -- attempt to decode.
    const decodedTxn = abiDecoder.decodeMethod(transaction.data);
    if (!decodedTxn) {
      // Cannot decode txn, just give the user the raw data.
      returnValue += "\nCannot decode transaction (does not match any UMA Protocol Signature.";
      returnValue += "\nRaw transaction data: " + transaction.data;
    } else {
      // Decode was successful -- pretty print the results.
      returnValue += "\nTransaction details:\n";
      returnValue += JSON.stringify(decodedTxn, null, 4);
    }
  }
  return returnValue;
}

module.exports = {
  decodeTransaction
};
