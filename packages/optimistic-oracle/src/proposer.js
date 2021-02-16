const { Networker, createReferencePriceFeedForFinancialContract } = require("@uma/financial-templates-lib");
const {
  getPrecisionForIdentifier,
  createObjectFromDefaultProps,
  MAX_UINT_VAL,
  formatFixed,
  parseFixed
} = require("@uma/common");
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
      },
      disputePricePrecisionOfError: {
        // `disputePricePrecisionOfError`: Proposal prices that do not equal the dispute price
        //                                 up to this decimal precision will be disputed.
        // Notes:
        // - Should be configured differently for each identifier based on UMIP specification.
        value: 6,
        isValid: x => {
          return x >= 0;
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
      at: "OptimisticOracleProposer#sendProposals",
      message: "Checking for unproposed price requests to send proposals for"
    });

    for (let priceRequest of this.optimisticOracleClient.getUnproposedPriceRequests()) {
      const priceFeed = await this._createOrGetCachedPriceFeed(priceRequest.identifier);

      // Pricefeed is either constructed correctly or is null.
      if (!priceFeed) {
        this.logger.error({
          at: "OptimisticOracleProposer#sendProposals",
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
          at: "OptimisticOracleProposer#sendProposals",
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
          at: "OptimisticOracleProposer#sendProposals",
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
        at: "OptimisticOracleProposer#sendProposals",
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
          at: "OptimisticOracleProposer#sendProposals",
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
        at: "OptimisticOracleProposer#sendProposals",
        message: "Proposed price!💍",
        priceRequest,
        proposalPrice,
        txnConfig,
        proposalResult: logResult
      });
    }
  }

  // Submit disputes to proposed price requests
  async sendDisputes() {
    this.logger.debug({
      at: "OptimisticOracleProposer#sendDisputes",
      message: "Checking for undisputed price requests to dispute"
    });

    for (let priceRequest of this.optimisticOracleClient.getUndisputedProposals()) {
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
        continue;
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
          disputePrice,
          error
        });
        continue;
      }

      // If proposal price is not equal to the dispute price up to specified precision of error, then
      // prepare dispute.
      const _roundHistoricalPriceToPrecision = _price => {
        // First convert historical price (in Wei) to float (using pricefeed's precision),
        // then round to desired precision,
        // and finally convert back into Wei.
        let weiToFloat = formatFixed(_price, priceFeed.getPriceFeedDecimals());
        let roundedWei = parseFloat(weiToFloat).toFixed(this.disputePricePrecisionOfError);
        let roundedFloatToWei = parseFixed(roundedWei.toString(), priceFeed.getPriceFeedDecimals());
        return roundedFloatToWei.toString();
      };

      let roundedDisputePrice = _roundHistoricalPriceToPrecision(disputePrice);
      let roundedProposalPrice = _roundHistoricalPriceToPrecision(proposalPrice);
      let isPriceDisputable = !this.toBN(roundedDisputePrice).eq(this.toBN(roundedProposalPrice));
      if (isPriceDisputable) {
        // Create the transaction.
        const dispute = this.ooContract.methods.disputePrice(
          priceRequest.requester,
          this.utf8ToHex(priceRequest.identifier),
          priceRequest.timestamp,
          priceRequest.ancillaryData
        );

        // Simple version of inventory management: simulate the transaction and assume that if it fails,
        // the caller didn't have enough collateral.
        let disputeBond, gasEstimation;
        try {
          [disputeBond, gasEstimation] = await Promise.all([
            dispute.call({ from: this.account }),
            dispute.estimateGas({ from: this.account })
          ]);
        } catch (error) {
          this.logger.error({
            at: "OptimisticOracleProposer#sendDisputes",
            message: "Cannot dispute price: not enough collateral (or large enough approval)✋",
            proposer: this.account,
            disputeBond,
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
          at: "OptimisticOracleProposer#sendDisputes",
          message: "Disputing proposal",
          priceRequest,
          roundedProposalPrice,
          roundedDisputePrice,
          txnConfig
        });

        // Send the transaction or report failure.
        let receipt;
        try {
          receipt = await dispute.send(txnConfig);
        } catch (error) {
          this.logger.error({
            at: "OptimisticOracleProposer#sendDisputes",
            message: "Failed to dispute proposal🚨",
            error
          });
          continue;
        }
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
          roundedProposalPrice,
          roundedDisputePrice,
          txnConfig,
          disputeResult: logResult
        });
      }
    }
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
    const approvalPromises = [];

    // Increase allowance to MAX for the `priceRequest.currency`
    const _approveCollateralCurrencyForPriceRequest = async priceRequest => {
      const collateralToken = new this.web3.eth.Contract(getAbi("ExpandedERC20"), priceRequest.currency);
      const currentCollateralAllowance = await collateralToken.methods
        .allowance(this.account, this.ooContract.options.address)
        .call();
      if (this.toBN(currentCollateralAllowance).lt(this.toBN(MAX_UINT_VAL).div(this.toBN("2")))) {
        const collateralApprovalPromise = collateralToken.methods
          .approve(this.ooContract.options.address, MAX_UINT_VAL)
          .send({
            from: this.account,
            gasPrice: this.gasEstimator.getCurrentFastPrice()
          })
          .then(tx => {
            this.logger.info({
              at: "OptimisticOracle#Proposer",
              message: "Approved OO to transfer unlimited collateral tokens 💰",
              currency: collateralToken.options.address,
              collateralApprovalTx: tx.transactionHash
            });
          });
        approvalPromises.push(collateralApprovalPromise);
      }
    };

    // The OO requires approval to transfer the proposed price request's collateral currency in order to post a bond.
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
