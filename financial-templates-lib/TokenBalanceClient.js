const { delay } = require("./delay");

// A thick client for getting information about an different token Balance from the chain.
// This client is kept separate from the other clients to only store token balances for a given EMP.
// After a balance is requested for a given wallet address that wallet is registered within a local
// array of addresses that the client monitors. This lets bots that implement the client retrieve the
// latest available data from the last update synchronously.
class TokenBalanceClient {
  constructor(logger, ERC20abi, web3, collateralTokenAddress, syntheticTokenAddress, updateThreshold = 60) {
    this.logger = logger;
    this.updateThreshold = updateThreshold;
    this.lastUpdateTimestamp;

    this.web3 = web3;

    // Token contracts
    this.collateralToken = new web3.eth.Contract(ERC20abi, collateralTokenAddress);
    this.syntheticToken = new web3.eth.Contract(ERC20abi, syntheticTokenAddress);

    // Token balances to enable synchronous return of the latest token ballance cashed in the client.
    this.tokenBalances = { collateralBalances: {}, syntheticBalances: {}, etherBalances: {} };

    // Array of balances to monitor. Updated when a new addresses balance is requested
    this.accountMonitorList = [];
  }

  // Calls _update unless it was recently called, as determined by this.updateThreshold.
  update = async () => {
    const currentTime = Math.floor(Date.now() / 1000);
    if (currentTime < this.lastUpdateTimestamp + this.updateThreshold) {
      this.logger.debug({
        at: "TokenBalanceClient",
        message: "Token Balances update skipped",
        currentTime: currentTime,
        lastUpdateTimestamp: this.lastUpdateTimestamp,
        timeRemainingUntilUpdate: this.lastUpdateTimestamp + this.updateThreshold - currentTime
      });
      return;
    } else {
      await this._update();
      this.lastUpdateTimestamp = currentTime;
      this.logger.debug({
        at: "TokenBalanceClient",
        message: "Token Balances updated",
        lastUpdateTimestamp: this.lastUpdateTimestamp
      });
    }
  };

  // Force call of _update, designed to be called by downstream caller that knowingly updated the Token Balances.
  forceUpdate = async () => {
    const currentTime = Math.floor(Date.now() / 1000);
    await this._update();
    this.lastUpdateTimestamp = currentTime;
    this.logger.debug({
      at: "TokenBalanceClient",
      message: "Token Balances force updated",
      lastUpdateTimestamp: this.lastUpdateTimestamp
    });
  };

  // Delete all data within the client
  clearState = async () => {
    this.tokenBalances = { collateralBalances: {}, syntheticBalances: {}, etherBalances: {} };
    this.accountMonitorList = [];
  };

  getCollateralBalance = address => {
    this._registerAddress(address);
    return this.tokenBalances.collateralBalances[address];
  };

  getSyntheticBalance = address => {
    this._registerAddress(address);
    return this.tokenBalances.syntheticBalances[address];
  };

  getEtherBalance = address => {
    this._registerAddress(address);
    return this.tokenBalances.etherBalances[address];
  };

  resolvedAddressBalance = address => {
    return this.tokenBalances.collateralBalances[address] != null;
  };

  _registerAddress = address => {
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
  };

  start = () => {
    this._poll();
  };

  _poll = async () => {
    while (true) {
      try {
        await this._update();
      } catch (error) {
        this.logger.error({
          at: "TokenBalanceClient",
          message: "client polling error",
          error: error
        });
      }
      await delay(Number(10_000));
    }
  };

  _update = async () => {
    // loop over all account addresses in the monitor list and for each check the balances of the
    // respective tokens and Eth balance. Store these for synchronous retrieval.
    for (let account of this.accountMonitorList) {
      // TODO: refactor this to create an array of promises for all accounts to monitor and resolve them all at once.
      this.tokenBalances.collateralBalances[account] = await this.collateralToken.methods.balanceOf(account).call();
      this.tokenBalances.syntheticBalances[account] = await this.syntheticToken.methods.balanceOf(account).call();
      this.tokenBalances.etherBalances[account] = await this.web3.eth.getBalance(account);
    }
  };
}

module.exports = {
  TokenBalanceClient
};
