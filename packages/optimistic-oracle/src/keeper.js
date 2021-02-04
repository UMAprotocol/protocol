const { Networker, createReferencePriceFeedForEmp } = require("@uma/financial-templates-lib");
const { getPrecisionForIdentifier } = require("@uma/common");

class OptimisticOracleKeeper {
  /**
   * @notice Constructs new OO Keeper bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} optimisticOracleClient Module used to query OO information on-chain.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} defaultPriceFeedConfig Default configuration to construct all price feed objects.
   */
  constructor({ logger, optimisticOracleClient, gasEstimator, account, defaultPriceFeedConfig }) {
    this.logger = logger;
    this.account = account;
    this.optimisticOracleClient = optimisticOracleClient;
    this.web3 = this.optimisticOracleClient.web3;
    this.defaultPriceFeedConfig = defaultPriceFeedConfig;

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

    this.optimisticOracleClient.getUnproposedPriceRequests().map(async priceRequest => {
      // Construct pricefeed config for this identifier. We start with the `defaultPriceFeedConfig`
      // properties and add custom properties for this specific identifier such as precision.
      let priceFeedConfig = {
        ...this.defaultPriceFeedConfig,
        priceFeedDecimals: getPrecisionForIdentifier(priceRequest.identifier)
      };
      this.logger.debug({
        at: "OptimisticOracleKeeper",
        message: "Created pricefeed configuration for identifier",
        defaultPriceFeedConfig: this.priceFeedConfig
      });

      // Create a new pricefeed for this identifier. We might consider caching these price requests
      // for re-use if any requests use the same identifier.
      let priceFeed = await createReferencePriceFeedForEmp(
        this.logger,
        this.web3,
        new Networker(this.logger),
        () => Math.round(new Date().getTime() / 1000),
        null, // No EMP Address needed since we're passing identifier explicitly
        priceFeedConfig,
        priceRequest.identifier
      );

      // Get a proposal price
      await priceFeed.update();
      const proposalPrice = priceFeed.getHistoricalPrice(priceRequest.timestamp);
      console.log(proposalPrice.toString());
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
