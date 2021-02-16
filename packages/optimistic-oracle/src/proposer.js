const { Networker, createReferencePriceFeedForFinancialContract } = require("@uma/financial-templates-lib");
const { getPrecisionForIdentifier, createObjectFromDefaultProps, MAX_UINT_VAL } = require("@uma/common");
const { getAbi } = require("@uma/core");

class OptimisticOracleProposer {
  /**
   * @notice Constructs new OO Proposer bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} optimisticOracleClient Module used to query OO information on-chain.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} defaultPriceFeedConfig Default configuration to construct all price feed objects.
   * @param {Object} [ooProposerConfig] Contains fields with which constructor will attempt to override defaults.
   */
  constructor({ logger, optimisticOracleClient, gasEstimator, account, defaultPriceFeedConfig, ooProposerConfig }) {
    this.logger = logger;
    this.account = account;
    this.optimisticOracleClient = optimisticOracleClient;
    this.web3 = this.optimisticOracleClient.web3;
    this.defaultPriceFeedConfig = defaultPriceFeedConfig;

    // Gas Estimator to calculate the current Fast gas rate.
    this.gasEstimator = gasEstimator;

    // Multiplier applied to Truffle's estimated gas limit for a transaction to send.
    this.GAS_LIMIT_BUFFER = 1.25;

    this.ooContract = this.optimisticOracleClient.oracle;

    // Cached mapping of identifiers to pricefeed classes
    this.priceFeedCache = {};

    // Helper functions from web3.
    this.BN = this.web3.utils.BN;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.fromWei = this.web3.utils.fromWei;
    this.utf8ToHex = this.web3.utils.utf8ToHex;
    this.hexToUtf8 = this.web3.utils.hexToUtf8;

    // Default config settings. Liquidator deployer can override these settings by passing in new
    // values via the `ooProposerConfig` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean.
    const defaultConfig = {
      txnGasLimit: {
        // `txnGasLimit`: Gas limit to set for sending on-chain transactions.
        value: 9000000, // Can see recent averages here: https://etherscan.io/chart/gaslimit
        isValid: x => {
          return x >= 6000000 && x < 15000000;
        }
      }
    };

    // Validate and set config settings to class state.
    const configWithDefaults = createObjectFromDefaultProps(ooProposerConfig, defaultConfig);
    Object.assign(this, configWithDefaults);
  }

  async update() {
    await Promise.all([this.optimisticOracleClient.update(), this.gasEstimator.update()]);

    // Increase allowances for all relevant collateral currencies.
    // TODO: Consider whether this should happen in a separate function (i.e. `setAllowances`) or within
    // the `sendProposals()` method.
    await this._setAllowances();
  }

  // Submit proposals to unproposed price requests.
  async sendProposals() {
    this.logger.debug({
      at: "OptimisticOracleProposer",
      message: "Checking for unproposed price requests to send proposals for"
    });

    for (let priceRequest of this.optimisticOracleClient.getUnproposedPriceRequests()) {
      const priceFeed = await this._createOrGetCachedPriceFeed(priceRequest.identifier);

      // Pricefeed is either constructed correctly or is null.
      if (!priceFeed) {
        this.logger.error({
          at: "OptimisticOracleProposer",
          message: "Failed to construct a PriceFeed for price request",
          priceRequest
        });
        continue;
      }

      // With pricefeed successfully constructed, get a proposal price
      await priceFeed.update();
      let proposalPrice;
      try {
        proposalPrice = (await priceFeed.getHistoricalPrice(priceRequest.timestamp)).toString();
      } catch (error) {
        this.logger.error({
          at: "OptimisticOracleProposer",
          message: "Failed to query historical price for price request",
          priceRequest,
          error
        });
        continue;
      }

      // Create the transaction.
      const proposal = this.ooContract.methods.proposePrice(
        priceRequest.requester,
        this.utf8ToHex(priceRequest.identifier),
        priceRequest.timestamp,
        priceRequest.ancillaryData,
        proposalPrice
      );

      // Simple version of inventory management: simulate the transaction and assume that if it fails,
      // the caller didn't have enough collateral.
      let proposalBond, gasEstimation;
      try {
        [proposalBond, gasEstimation] = await Promise.all([
          proposal.call({ from: this.account }),
          proposal.estimateGas({ from: this.account })
        ]);
      } catch (error) {
        this.logger.error({
          at: "OptimisticOracle#Proposer",
          message: "Cannot propose price: not enough collateral (or large enough approval)✋",
          proposer: this.account,
          proposalBond,
          priceRequest,
          error
        });
        continue;
      }
      const txnConfig = {
        from: this.account,
        gas: Math.min(Math.floor(gasEstimation * this.GAS_LIMIT_BUFFER), this.txnGasLimit),
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      };

      this.logger.debug({
        at: "OptimisticOracle#Proposer",
        message: "Proposing new price",
        priceRequest,
        proposalPrice,
        txnConfig
      });

      // Send the transaction or report failure.
      let receipt;
      try {
        receipt = await proposal.send(txnConfig);
      } catch (error) {
        this.logger.error({
          at: "OptimisticOracle#Proposer",
          message: "Failed to propose price🚨",
          error
        });
        continue;
      }
      const logResult = {
        tx: receipt.transactionHash,
        requester: receipt.events.ProposePrice.returnValues.requester,
        proposer: receipt.events.ProposePrice.returnValues.proposer,
        identifier: this.hexToUtf8(receipt.events.ProposePrice.returnValues.identifier),
        ancillaryData: receipt.events.ProposePrice.returnValues.ancillaryData,
        timestamp: receipt.events.ProposePrice.returnValues.timestamp,
        proposedPrice: receipt.events.ProposePrice.returnValues.proposedPrice,
        expirationTimestamp: receipt.events.ProposePrice.returnValues.expirationTimestamp
      };
      this.logger.info({
        at: "OptimisticOracle#Proposer",
        message: "Proposed price!💍",
        priceRequest,
        proposalPrice,
        txnConfig,
        proposalResult: logResult
      });
    }
  }

  async sendDisputes() {
    // TODO
  }

  async settleRequests() {
    // TODO
  }

  /** **********************************
   *
   * INTERNAL METHODS
   *
   ************************************/

  // Sets allowances for all collateral currencies used in unproposed price requests
  async _setAllowances() {
    // TODO: Should we do this also for currencies from undisputedProposals?
    for (let priceRequest of this.optimisticOracleClient.getUnproposedPriceRequests()) {
      // The OO requires approval to transfer the proposed price request's collateral currency in order to post a bond.
      // We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
      const collateralToken = new this.web3.eth.Contract(getAbi("ExpandedERC20"), priceRequest.currency);
      const [currentCollateralAllowance] = await Promise.all([
        collateralToken.methods.allowance(this.account, this.ooContract.options.address).call()
      ]);
      if (this.toBN(currentCollateralAllowance).lt(this.toBN(MAX_UINT_VAL).div(this.toBN("2")))) {
        const collateralApprovalTx = await collateralToken.methods
          .approve(this.ooContract.options.address, MAX_UINT_VAL)
          .send({
            from: this.account,
            gasPrice: this.gasEstimator.getCurrentFastPrice()
          });
        this.logger.info({
          at: "OptimisticOracle#Proposer",
          message: "Approved OO to transfer unlimited collateral tokens 💰",
          currency: collateralToken.options.address,
          collateralApprovalTx: collateralApprovalTx.transactionHash
        });
      }
    }
  }

  // Create the pricefeed for a specific identifier and save it to the state, or
  // return the saved pricefeed if already constructed.
  async _createOrGetCachedPriceFeed(identifier) {
    // First check for cached pricefeed for this identifier and return it if exists:
    let priceFeed = this.priceFeedCache[identifier];
    if (priceFeed) return priceFeed;

    // No cached pricefeed found for this identifier. Create a new one.
    // First, construct the config for this identifier. We start with the `defaultPriceFeedConfig`
    // properties and add custom properties for this specific identifier such as precision.
    let priceFeedConfig = {
      ...this.defaultPriceFeedConfig,
      priceFeedDecimals: getPrecisionForIdentifier(identifier)
    };
    this.logger.debug({
      at: "OptimisticOracleProposer",
      message: "Created pricefeed configuration for identifier",
      defaultPriceFeedConfig: this.priceFeedConfig,
      identifier
    });

    // Create a new pricefeed for this identifier. We might consider caching these price requests
    // for re-use if any requests use the same identifier.
    let newPriceFeed = await createReferencePriceFeedForFinancialContract(
      this.logger,
      this.web3,
      new Networker(this.logger),
      () => Math.round(new Date().getTime() / 1000),
      null, // No EMP Address needed since we're passing identifier explicitly
      priceFeedConfig,
      identifier
    );
    this.priceFeedCache[identifier] = newPriceFeed;
    return newPriceFeed;
  }
}

module.exports = {
  OptimisticOracleProposer
};
