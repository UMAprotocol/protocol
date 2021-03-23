// Provides convenience methods for interacting with deployed Multicall contract on network.
const { getAbi } = require("@uma/core");
const multicallAddressMap = require("@makerdao/multicall/src/addresses.json");

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

// Dictionary of ABI's for contract methods that we can use to decode
// to Javascript type.
const contractMethodABIs = {
  fundingRate: [
    {
      components: [
        {
          internalType: "int256",
          name: "rawValue",
          type: "int256"
        }
      ],
      internalType: "struct FixedPoint.Signed",
      name: "rate",
      type: "tuple"
    },
    {
      internalType: "bytes32",
      name: "identifier",
      type: "bytes32"
    },
    {
      components: [
        {
          internalType: "uint256",
          name: "rawValue",
          type: "uint256"
        }
      ],
      internalType: "struct FixedPoint.Unsigned",
      name: "cumulativeMultiplier",
      type: "tuple"
    },
    {
      internalType: "uint256",
      name: "updateTime",
      type: "uint256"
    },
    {
      internalType: "uint256",
      name: "applicationTime",
      type: "uint256"
    },
    {
      internalType: "uint256",
      name: "proposalTime",
      type: "uint256"
    }
  ]
};

module.exports = {
  aggregateTransactionsAndCall,
  contractMethodABIs,
  multicallAddressMap
};
