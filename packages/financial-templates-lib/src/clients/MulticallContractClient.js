// Provides convenience methods for interacting with deployed Multicall contract on network.

class MulticallContractClient {
  /**
   * @notice Constructs new MulticallClient.
   * @param {Object} multicallAbi truffle ABI object.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} multicallAddress Ethereum address of the Multicall contract deployed on the current network.
   * @return None or throws an Error.
   */
  constructor(multicallAbi, web3, multicallAddress) {
    this.web3 = web3;

    // Multicall contract
    this.multicallContract = new web3.eth.Contract(multicallAbi, multicallAddress);
  }

  // Simulate submitting a batch of `transactions` to the multicall contact
  // and return an array of simulated output values. Caller will need to
  // decode the return values via web3.eth.abi.decodeParameters([types], outputBytes).
  async aggregateTransactionsAndCall(transactions) {
    for (let i = 0; i < transactions.length; i++) {
      assert(
        transactions[i].target && transactions[i].callData,
        "transaction expected in form {target: address, callData: bytes}"
      );
    }
    return await this.multicallContract.methods.aggregate(transactions).call();
  }
}

module.exports = { MulticallContractClient };
