const { Networker, createReferencePriceFeedForFinancialContract } = require("@uma/financial-templates-lib");
const {
  getPrecisionForIdentifier,
  createObjectFromDefaultProps,
  MAX_UINT_VAL,
  runTransaction
} = require("@uma/common");
const { getAbi } = require("@uma/core");

class OptimisticOracleProposer {
  /**
   * @notice Constructs new OO Proposer bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} optimisticOracleClient Module used to query OO information on-chain.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} commonPriceFeedConfig Default configuration to construct all price feed objects.
   * @param {Object} [optimisticOracleProposerConfig] Contains fields with which constructor will attempt to override defaults.
   */
  constructor({
    logger,
    optimisticOracleClient,
    gasEstimator,
    account,
    commonPriceFeedConfig,
    optimisticOracleProposerConfig
  }) {
    this.logger = logger;
    this.account = account;
    this.optimisticOracleClient = optimisticOracleClient;
    this.web3 = this.optimisticOracleClient.web3;
    this.commonPriceFeedConfig = commonPriceFeedConfig;

    // Gas Estimator to calculate the current Fast gas rate.
    this.gasEstimator = gasEstimator;

    this.optimisticOracleContract = this.optimisticOracleClient.oracle;

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
    // values via the `optimisticOracleProposerConfig` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean.
    const defaultConfig = {
      disputePriceErrorPercent: {
        // `disputePricePrecisionOfError`: Proposal prices that differ from the dispute price
        //                                 more than this % error will be disputed. e.g. 0.05
        //                                 implies 5% margin of error from the historical price
        //                                 computed by the local pricefeed.
        value: 0.05,
        isValid: x => {
          return x >= 0 && x < 1;
        }
      }
    };

    // Validate and set config settings to class state.
    const configWithDefaults = createObjectFromDefaultProps(optimisticOracleProposerConfig, defaultConfig);
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
      at: "OptimisticOracleProposer#sendProposals",
      message: "Checking for unproposed price requests to send proposals for"
    });

    // TODO: Should allow user to filter out price requests with rewards below a threshold,
    // allowing the bot to prevent itself from being induced to unprofitably propose.
    for (let priceRequest of this.optimisticOracleClient.getUnproposedPriceRequests()) {
      await this._sendProposal(priceRequest);
    }
  }

  // Submit disputes to proposed price requests.
  async sendDisputes() {
    this.logger.debug({
      at: "OptimisticOracleProposer#sendDisputes",
      message: "Checking for undisputed price requests to dispute"
    });

    for (let priceRequest of this.optimisticOracleClient.getUndisputedProposals()) {
      await this._sendDispute(priceRequest);
    }
  }

  // Settle disputes where this bot was the disputer and proposals where this bot was the proposer.
  async settleRequests() {
    this.logger.debug({
      at: "OptimisticOracleProposer#settleRequests",
      message: "Checking for proposals and disputes to settle"
    });

    for (let priceRequest of this.optimisticOracleClient
      .getSettleableProposals(this.account)
      .concat(this.optimisticOracleClient.getSettleableDisputes(this.account))) {
      await this._settleRequest(priceRequest);
    }
  }

  /** **********************************
   *
   * INTERNAL METHODS
   *
   ************************************/

  // Construct proposal transaction and send or return early if an error is encountered.
  async _sendProposal(priceRequest) {
    const priceFeed = await this._createOrGetCachedPriceFeed(priceRequest.identifier);

    // Pricefeed is either constructed correctly or is null.
    if (!priceFeed) {
      this.logger.error({
        at: "OptimisticOracleProposer#sendProposals",
        message: "Failed to construct a PriceFeed for price request",
        priceRequest
      });
      return;
    }

    // With pricefeed successfully constructed, get a proposal price
    await priceFeed.update();
    let proposalPrice;
    try {
      proposalPrice = (await priceFeed.getHistoricalPrice(priceRequest.timestamp)).toString();
    } catch (error) {
      this.logger.error({
        at: "OptimisticOracleProposer#sendProposals",
        message: "Failed to query historical price for price request",
        priceRequest,
        error
      });
      return;
    }

    // Get successful transaction receipt and return value or error.
    const proposal = this.optimisticOracleContract.methods.proposePrice(
      priceRequest.requester,
      this.utf8ToHex(priceRequest.identifier),
      priceRequest.timestamp,
      priceRequest.ancillaryData,
      proposalPrice
    );
    const transactionConfig = {
      gasPrice: this.gasEstimator.getCurrentFastPrice(),
      from: this.account
    };
    this.logger.debug({
      at: "OptimisticOracleProposer#sendProposals",
      message: "Proposing new price",
      priceRequest,
      proposalPrice,
      transactionConfig
    });
    try {
      const transactionResult = await runTransaction({
        transaction: proposal,
        config: transactionConfig
      });
      let receipt = transactionResult.receipt;
      let returnValue = transactionResult.returnValue;

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
        at: "OptimisticOracleProposer#sendProposals",
        message: "Proposed price!💍",
        priceRequest,
        proposalBond: returnValue,
        proposalPrice,
        transactionConfig,
        proposalResult: logResult
      });
    } catch (error) {
      const message =
        error.type === "call"
          ? "Cannot propose price: not enough collateral (or large enough approval)✋"
          : "Failed to propose price🚨";
      this.logger.error({
        at: "OptimisticOracleProposer#sendProposals",
        message,
        priceRequest,
        error
      });
      return;
    }
  }
  // Construct dispute transaction and send or return early if an error is encountered.
  async _sendDispute(priceRequest) {
    // Get proposal price
    let proposalPrice = priceRequest.proposedPrice;

    // Create pricefeed for identifier
    const priceFeed = await this._createOrGetCachedPriceFeed(priceRequest.identifier);

    // Pricefeed is either constructed correctly or is null.
    if (!priceFeed) {
      this.logger.error({
        at: "OptimisticOracleProposer#sendDisputes",
        message: "Failed to construct a PriceFeed for price request",
        priceRequest
      });
      return;
    }

    // With pricefeed successfully constructed, confirm the proposal price
    await priceFeed.update();
    let disputePrice;
    try {
      disputePrice = (await priceFeed.getHistoricalPrice(priceRequest.timestamp)).toString();
    } catch (error) {
      this.logger.error({
        at: "OptimisticOracleProposer#sendDisputes",
        message: "Failed to query historical price for price request",
        priceRequest,
        error
      });
      return;
    }

    // Return true if `_baselinePrice` * (1 - error %) <= `_testPrice` <= `_baselinePrice` * (1 + error %)
    // else false.
    const _comparePricesWithErrorMargin = (_baselinePrice, _testPrice) => {
      // Note: BN.js does not perform math on decimals, so we will convert the %'s to Wei and back.
      const lowerMargin = _baselinePrice
        .mul(this.toBN(this.toWei((1 - this.disputePriceErrorPercent).toString())))
        .div(this.toBN(this.toWei("1")));
      const upperMargin = _baselinePrice
        .mul(this.toBN(this.toWei((1 + this.disputePriceErrorPercent).toString())))
        .div(this.toBN(this.toWei("1")));
      return _testPrice.gte(lowerMargin) && _testPrice.lte(upperMargin);
    };

    // If proposal price is not equal to the dispute price within margin of error, then
    // prepare dispute. Basically we're assuming that the `disputePrice` is the baseline
    // price.
    let isPriceDisputable = !_comparePricesWithErrorMargin(
      this.toBN(disputePrice.toString()),
      this.toBN(proposalPrice.toString())
    );
    if (isPriceDisputable) {
      // Get successful transaction receipt and return value or error.
      const dispute = this.optimisticOracleContract.methods.disputePrice(
        priceRequest.requester,
        this.utf8ToHex(priceRequest.identifier),
        priceRequest.timestamp,
        priceRequest.ancillaryData
      );
      const transactionConfig = {
        gasPrice: this.gasEstimator.getCurrentFastPrice(),
        from: this.account
      };
      this.logger.debug({
        at: "OptimisticOracleProposer#sendDisputes",
        message: "Disputing proposal",
        priceRequest,
        proposalPrice,
        disputePrice,
        allowedError: this.disputePriceErrorPercent,
        transactionConfig
      });
      try {
        const transactionResult = await runTransaction({
          transaction: dispute,
          config: transactionConfig
        });
        let receipt = transactionResult.receipt;
        let returnValue = transactionResult.returnValue;

        const logResult = {
          tx: receipt.transactionHash,
          requester: receipt.events.DisputePrice.returnValues.requester,
          proposer: receipt.events.DisputePrice.returnValues.proposer,
          disputer: receipt.events.DisputePrice.returnValues.disputer,
          identifier: this.hexToUtf8(receipt.events.DisputePrice.returnValues.identifier),
          ancillaryData: receipt.events.DisputePrice.returnValues.ancillaryData,
          timestamp: receipt.events.DisputePrice.returnValues.timestamp,
          proposedPrice: receipt.events.DisputePrice.returnValues.proposedPrice
        };
        this.logger.info({
          at: "OptimisticOracleProposer#sendDisputes",
          message: "Disputed proposal!⛑",
          priceRequest,
          disputePrice,
          disputeBond: returnValue,
          allowedError: this.disputePriceErrorPercent,
          transactionConfig,
          disputeResult: logResult
        });
      } catch (error) {
        const message =
          error.type === "call"
            ? "Cannot dispute price: not enough collateral (or large enough approval)✋"
            : "Failed to dispute proposal🚨";
        this.logger.error({
          at: "OptimisticOracleProposer#sendDisputes",
          message,
          priceRequest,
          error
        });
        return;
      }
    }
  }
  // Construct settlement transaction and send or return early if an error is encountered.
  async _settleRequest(priceRequest) {
    // Get successful transaction receipt and return value or error.
    const settle = this.optimisticOracleContract.methods.settle(
      priceRequest.requester,
      this.utf8ToHex(priceRequest.identifier),
      priceRequest.timestamp,
      priceRequest.ancillaryData
    );
    const transactionConfig = {
      gasPrice: this.gasEstimator.getCurrentFastPrice(),
      from: this.account
    };
    this.logger.debug({
      at: "OptimisticOracleProposer#settleRequests",
      message: "Settling proposal or dispute",
      priceRequest,
      transactionConfig
    });
    try {
      const transactionResult = await runTransaction({
        transaction: settle,
        config: transactionConfig
      });
      let receipt = transactionResult.receipt;
      let returnValue = transactionResult.returnValue;

      const logResult = {
        tx: receipt.transactionHash,
        requester: receipt.events.Settle.returnValues.requester,
        proposer: receipt.events.Settle.returnValues.proposer,
        disputer: receipt.events.Settle.returnValues.disputer,
        identifier: this.hexToUtf8(receipt.events.Settle.returnValues.identifier),
        ancillaryData: receipt.events.Settle.returnValues.ancillaryData,
        timestamp: receipt.events.Settle.returnValues.timestamp,
        price: receipt.events.Settle.returnValues.price,
        payout: receipt.events.Settle.returnValues.payout
      };
      this.logger.info({
        at: "OptimisticOracleProposer#settleRequests",
        message: "Settled proposal or dispute!⛑",
        priceRequest,
        payout: returnValue,
        transactionConfig,
        settleResult: logResult
      });
    } catch (error) {
      const message =
        error.type === "call" ? "Cannot settle for unknown reason☹️" : "Failed to settle proposal or dispute🚨";
      this.logger.error({
        at: "OptimisticOracleProposer#settleRequests",
        message,
        priceRequest,
        error
      });
      return;
    }
  }
  // Sets allowances for all collateral currencies used in unproposed price requests
  async _setAllowances() {
    const approvalPromises = [];

    // Increase allowance to MAX for the `priceRequest.currency`
    const _approveCollateralCurrencyForPriceRequest = async priceRequest => {
      const collateralToken = new this.web3.eth.Contract(getAbi("ExpandedERC20"), priceRequest.currency);
      const currentCollateralAllowance = await collateralToken.methods
        .allowance(this.account, this.optimisticOracleContract.options.address)
        .call({
          from: this.account,
          gasPrice: this.gasEstimator.getCurrentFastPrice()
        });
      if (this.toBN(currentCollateralAllowance).lt(this.toBN(MAX_UINT_VAL).div(this.toBN("2")))) {
        const collateralApprovalPromise = collateralToken.methods
          .approve(this.optimisticOracleContract.options.address, MAX_UINT_VAL)
          .send({
            from: this.account,
            gasPrice: this.gasEstimator.getCurrentFastPrice()
          })
          .then(tx => {
            this.logger.info({
              at: "OptimisticOracle#Proposer",
              message: "Approved OptimisticOracle to transfer unlimited collateral tokens 💰",
              currency: collateralToken.options.address,
              collateralApprovalTx: tx.transactionHash
            });
          });
        approvalPromises.push(collateralApprovalPromise);
      }
    };

    // The OptimisticOracle requires approval to transfer the proposed price request's collateral currency in order to post a bond.
    // We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
    for (let priceRequest of this.optimisticOracleClient.getUnproposedPriceRequests()) {
      await _approveCollateralCurrencyForPriceRequest(priceRequest);
    }

    // We also approve currencies stored in disputes if for some reason they were not approved already.
    for (let priceRequest of this.optimisticOracleClient.getUndisputedProposals()) {
      await _approveCollateralCurrencyForPriceRequest(priceRequest);
    }

    await Promise.all(approvalPromises);
  }

  // Create the pricefeed for a specific identifier and save it to the state, or
  // return the saved pricefeed if already constructed.
  async _createOrGetCachedPriceFeed(identifier) {
    // First check for cached pricefeed for this identifier and return it if exists:
    let priceFeed = this.priceFeedCache[identifier];
    if (priceFeed) return priceFeed;

    // No cached pricefeed found for this identifier. Create a new one.
    // First, construct the config for this identifier. We start with the `commonPriceFeedConfig`
    // properties and add custom properties for this specific identifier such as precision.
    let priceFeedConfig = {
      ...this.commonPriceFeedConfig,
      priceFeedDecimals: getPrecisionForIdentifier(identifier)
    };
    this.logger.debug({
      at: "OptimisticOracleProposer",
      message: "Created pricefeed configuration for identifier",
      commonPriceFeedConfig: this.commonPriceFeedConfig,
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
