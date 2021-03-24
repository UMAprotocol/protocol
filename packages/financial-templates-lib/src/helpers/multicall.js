// Provides convenience methods for interacting with deployed Multicall contract on network.
const { getAbi } = require("@uma/core");
const { getAbiDecoder } = require("@uma/common");
const multicallAddressMap = require("@makerdao/multicall/src/addresses.json");
const assert = require("assert");

let cachedAbiDecoder;

// Decode `returnData` into Javascript type using known contract ABI informtaion
// from the `callData` originally used to produce `returnData`.
function _decodeOutput(callData, returnData, web3) {
  let abiDecoder = cachedAbiDecoder || getAbiDecoder(); // Only load once because it's expensive.
  const methodAbi = abiDecoder.getMethodIDs()[callData.slice(2, 10)];
  return web3.eth.abi.decodeParameters(methodAbi.outputs, returnData);
}

// Simulate submitting a batch of `transactions` to the multicall contact
// and return an array of decoded, simulated output values.
const aggregateTransactionsAndCall = async (multicallAddress, web3, transactions) => {
  const multicallContract = new web3.eth.Contract(getAbi("Multicall"), multicallAddress);
  for (let i = 0; i < transactions.length; i++) {
    assert(
      transactions[i].target && transactions[i].callData,
      "transaction expected in form {target: address, callData: bytes}"
    );
  }

  // Decode return data, which is an array of the same length as `transactions`:
  const returnData = (await multicallContract.methods.aggregate(transactions).call()).returnData;
  const decodedOutputs = [];
  returnData.forEach((data, i) => {
    decodedOutputs.push(_decodeOutput(transactions[i].callData, data, web3));
  });
  return decodedOutputs;
};

module.exports = {
  aggregateTransactionsAndCall,
  multicallAddressMap
};
