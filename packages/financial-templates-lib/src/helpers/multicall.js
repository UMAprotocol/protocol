// Provides convenience methods for interacting with deployed Multicall contract on network.
const { getAbi } = require("@uma/core");
const multicallAddressMap = require("@makerdao/multicall/src/addresses.json");
const assert = require("assert");

// Simulate submitting a batch of `transactions` to the multicall contact
// and return an array of simulated output values. Caller will need to
// decode the return values via web3.eth.abi.decodeParameters([types], outputBytes).
const aggregateTransactionsAndCall = async (multicallAddress, web3, transactions) => {
  const multicallContract = new web3.eth.Contract(getAbi("Multicall"), multicallAddress);
  for (let i = 0; i < transactions.length; i++) {
    assert(
      transactions[i].target && transactions[i].callData,
      "transaction expected in form {target: address, callData: bytes}"
    );
  }
  return await multicallContract.methods.aggregate(transactions).call();
};

module.exports = {
  aggregateTransactionsAndCall,
  multicallAddressMap
};
