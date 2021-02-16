// A thick client for getting information about an different token Balance from the chain. This client is kept separate
// from the other clients to only store token balances for a given Financial Contract. After a balance is requested for a given wallet
// address that wallet is registered within a local array of addresses that the client monitors. This lets bots that
// implement the client retrieve the latest available data from the last update synchronously.
class TokenBalanceClient {
  /**
   * @notice Constructs new TokenBalanceClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} erc20abi ERC20 token abi used to create a token contract instance to query.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} collateralTokenAddress Ethereum address of the Collateral ERC20 token from the Financial Contract.
   * @param {String} syntheticTokenAddress Ethereum address of the Synthetic ERC20 token from the Financial Contract.
   * @return None or throws an Error.
   */
  constructor(logger, erc20abi, web3, collateralTokenAddress, syntheticTokenAddress) {
    this.logger = logger;
    this.web3 = web3;

    // Token contracts
    this.collateralToken = new web3.eth.Contract(erc20abi, collateralTokenAddress);
    this.syntheticToken = new web3.eth.Contract(erc20abi, syntheticTokenAddress);

    // Token balances to enable synchronous return of the latest token ballance cashed in the client.
    this.tokenBalances = { collateralBalances: {}, syntheticBalances: {}, etherBalances: {} };

    // Array of balances to monitor. Updated when a new addresses balance is requested.
    this.accountMonitorList = [];
  }

  // Delete all data within the client.
  clearState() {
    this.tokenBalances = { collateralBalances: {}, syntheticBalances: {}, etherBalances: {} };
    this.accountMonitorList = [];
  }

  getCollateralBalance(address) {
    this._registerAddress(address);
    return this.tokenBalances.collateralBalances[address];
  }

  getSyntheticBalance(address) {
    this._registerAddress(address);
    return this.tokenBalances.syntheticBalances[address];
  }

  getEtherBalance(address) {
    this._registerAddress(address);
    return this.tokenBalances.etherBalances[address];
  }

  // Checks if an address has a resolved value(has been updated past it's initialization state).
  resolvedAddressBalance(address) {
    return this.tokenBalances.collateralBalances[address] != null;
  }

  // Batch register an array of addresses. This can be used by a client implementor to register addresses on
  // construction to enable synchronous retrieval on the first loop.
  batchRegisterAddresses(addresses) {
    for (const address of addresses) {
      this._registerAddress(address);
    }
  }

  // Loop over all account addresses in the monitor list and for each check the balances of the
  // respective tokens and Eth balance. Store these for synchronous retrieval.
  async update() {
    for (let account of this.accountMonitorList) {
      const tokenBalancesObject = await this.getDirectTokenBalances(account);
      this.tokenBalances.collateralBalances[account] = tokenBalancesObject.collateralBalance;
      this.tokenBalances.syntheticBalances[account] = tokenBalancesObject.syntheticBalance;
      this.tokenBalances.etherBalances[account] = tokenBalancesObject.etherBalance;
    }

    this.logger.debug({
      at: "TokenBalanceClient",
      message: "Token balance storage updated"
    });
  }

  // Async function to get the three token balances directly. Does not store balances for later retrieval.
  async getDirectTokenBalances(account) {
    const [collateralBalance, syntheticBalance, etherBalance] = await Promise.all([
      this.collateralToken.methods.balanceOf(account).call(),
      this.syntheticToken.methods.balanceOf(account).call(),
      this.web3.eth.getBalance(account)
    ]);
    return { collateralBalance, syntheticBalance, etherBalance };
  }

  // Add an address to the monitored address list. Balance will only update when calling the `update()` function.
  _registerAddress(address) {
    if (!this.accountMonitorList.includes(address)) {
      this.accountMonitorList.push(address);
      this.tokenBalances.collateralBalances[address] = null;
      this.tokenBalances.syntheticBalances[address] = null;
      this.tokenBalances.etherBalances[address] = null;

      this.logger.debug({
        at: "TokenBalanceClient",
        message: "New address requested, adding address to monitor list.",
        address: address
      });
    }
  }
}

module.exports = {
  TokenBalanceClient
};
