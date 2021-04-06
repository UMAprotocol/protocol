// Provides convenience methods for interacting with deployed Multicall contract on network.
const { getAbi } = require("@uma/core");
const { getAbiDecoder } = require("@uma/common");
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
const aggregateTransactionsAndCall = async (multicallAddress, web3, transactions, blockNumber) => {
  const multicallContract = new web3.eth.Contract(getAbi("Multicall"), multicallAddress);
  for (let i = 0; i < transactions.length; i++) {
    assert(
      transactions[i].target && transactions[i].callData,
      "transaction expected in form {target: address, callData: bytes}"
    );
  }

  // Decode return data, which is an array of the same length as `transactions`:
  const returnData = (await multicallContract.methods.aggregate(transactions).call(undefined, blockNumber)).returnData;
  return returnData.map((data, i) => _decodeOutput(transactions[i].callData, data, web3));
};

const multicallAddressMap = {
  mainnet: {
    multicall: "0xeefba1e63905ef1d7acba5a8513c70307c1ce441"
  },
  kovan: {
    multicall: "0x2cc8688c5f75e365aaeeb4ea8d6a480405a48d2a"
  },
  rinkeby: {
    multicall: "0x42ad527de7d4e9d9d011ac45b31d8551f8fe9821"
  },
  goerli: {
    multicall: "0x77dca2c955b15e9de4dbbcf1246b4b85b651e50e"
  },
  xdai: {
    multicall: "0xb5b692a88bdfc81ca69dcb1d924f59f0413a602a"
  }
};

module.exports = {
  aggregateTransactionsAndCall,
  multicallAddressMap
};
