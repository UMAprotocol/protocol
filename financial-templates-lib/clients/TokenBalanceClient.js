// A thick client for getting information about an different token Balance from the chain. This client is kept separate
// from the other clients to only store token balances for a given EMP. After a balance is requested for a given wallet
// address that wallet is registered within a local array of addresses that the client monitors. This lets bots that
// implement the client retrieve the latest available data from the last update synchronously.
class TokenBalanceClient {
  /**
   * @notice Constructs new TokenBalanceClient.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} erc20abi ERC20 token abi used to create a token contract instance to query.
   * @param {Object} web3 Provider from Truffle instance to connect to Ethereum network.
   * @param {String} collateralTokenAddress Ethereum address of the Collateral ERC20 token from the EMP.
   * @param {String} syntheticTokenAddress Ethereum address of the Synthetic ERC20 token from the EMP.
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
  clearState = () => {
    this.tokenBalances = { collateralBalances: {}, syntheticBalances: {}, etherBalances: {} };
    this.accountMonitorList = [];
  };

  getCollateralBalance = async address => {
    await this._registerAddress(address);
    return this.tokenBalances.collateralBalances[address];
  };

  getSyntheticBalance = async address => {
    await this._registerAddress(address);
    return this.tokenBalances.syntheticBalances[address];
  };

  getEtherBalance = async address => {
    await this._registerAddress(address);
    return this.tokenBalances.etherBalances[address];
  };

  resolvedAddressBalance = address => {
    return this.tokenBalances.collateralBalances[address] != null;
  };

  update = async () => {
    // loop over all account addresses in the monitor list and for each check the balances of the
    // respective tokens and Eth balance. Store these for synchronous retrieval.
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
  };

  // Async function to get the three token balances directly. Does not store balances for later retrieval.
  // TODO: refactor this to create an array of promises for all accounts to monitor and resolve them all at once.
  getDirectTokenBalances = async account => {
    return {
      collateralBalance: await this.collateralToken.methods.balanceOf(account).call(),
      syntheticBalance: await this.syntheticToken.methods.balanceOf(account).call(),
      etherBalance: await this.web3.eth.getBalance(account)
    };
  };

  // If the address requested has not been fetched before then will query the balances. If it has, then do nothing
  // Balance will only update when calling the `update` function.
  _registerAddress = async address => {
    if (!this.accountMonitorList.includes(address)) {
      this.accountMonitorList.push(address);
      const tokenBalancesObject = await this.getDirectTokenBalances(address);
      this.tokenBalances.collateralBalances[address] = tokenBalancesObject.collateralBalance;
      this.tokenBalances.syntheticBalances[address] = tokenBalancesObject.syntheticBalance;
      this.tokenBalances.etherBalances[address] = tokenBalancesObject.etherBalance;

      this.logger.debug({
        at: "TokenBalanceClient",
        message: "New address requested, adding address to monitor list.",
        address: address
      });
    }
  };
}

module.exports = {
  TokenBalanceClient
};
