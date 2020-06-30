// A thick client for getting information about the deployed DVM contract.

class DVMClient {
  /**
   * @notice Constructs new DVMClient.
   * @param {Object} votingABI Voting truffle ABI object to create a contract instance.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} votingAddress Ethereum address of the DVM contract deployed on the current network.
   * @return None or throws an Error.
   */
  constructor(votingABI, web3, votingAddress) {
    this.web3 = web3;

    // DVM contract
    this.dvm = new web3.eth.Contract(votingABI, votingAddress);
    this.votingAddress = votingAddress;

    // Helper functions from web3.
    this.utf8ToHex = this.web3.utils.utf8ToHex;
  }
}

module.exports = {
  DVMClient
};
