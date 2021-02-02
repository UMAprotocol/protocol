class OptimisticOracleKeeper {
  /**
   * @notice Constructs new OO Keeper bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} optimisticOracleClient Module used to query OO information on-chain.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {String} account Ethereum account from which to send txns.
   */
  constructor({ logger, optimisticOracleClient, gasEstimator, account }) {
    this.logger = logger;
    this.account = account;
    this.optimisticOracleClient = optimisticOracleClient;
    this.web3 = this.optimisticOracleClient.web3;

    // Gas Estimator to calculate the current Fast gas rate.
    this.gasEstimator = gasEstimator;

    this.ooContract = this.optimisticOracleClient.emp;

    // Helper functions from web3.
    this.BN = this.web3.utils.BN;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.fromWei = this.web3.utils.fromWei;
    this.utf8ToHex = this.web3.utils.utf8ToHex;
  }

  async update() {
    await Promise.all([this.optimisticOracleClient.update(), this.gasEstimator.update()]);
  }

  async sendProposals() {
    this.logger.debug({
      at: "OptimisticOracleKeeper",
      message: "Checking for unproposed price requsts to send proposals for"
    });

    // Grab unproposed price requests
    // For each request:
    // - Create a pricefeed for identifier
    // - Get proposal price
    // - Send proposal
  }

  async sendDisputes() {
    this.logger.debug({
      at: "OptimisticOracleKeeper",
      message: "Checking for disputable proposals to dispute"
    });

    // Grab undisputed price request proposals
    // For each request:
    // - Create a pricefeed for identifier
    // - Get disputable price
    // - Send proposal
  }
}

module.exports = {
  OptimisticOracleKeeper
};
