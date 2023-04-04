const {
  Networker,
  createReferencePriceFeedForFinancialContract,
  setAllowance,
  isDeviationOutsideErrorMargin,
  OptimisticOracleType,
} = require("@uma/financial-templates-lib");
const {
  createFormatFunction,
  createEtherscanLinkMarkdown,
  parseAncillaryData,
  createObjectFromDefaultProps,
  runTransaction,
  ZERO_ADDRESS,
} = require("@uma/common");
const { getAbi } = require("@uma/contracts-node");

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
    optimisticOracleProposerConfig,
    ignoredIdentifiersPostExpiry,
    ignoredIdentifiers,
  }) {
    this.logger = logger;
    this.account = account;
    this.optimisticOracleClient = optimisticOracleClient;
    this.web3 = this.optimisticOracleClient.web3;
    this.commonPriceFeedConfig = commonPriceFeedConfig;
    this.chainId = optimisticOracleClient.chainId;
    this.ignoredIdentifiersPostExpiry = ignoredIdentifiersPostExpiry || [];
    this.ignoredIdentifiers = ignoredIdentifiers || [];

    // Gas Estimator to calculate the current Fast gas rate.
    this.gasEstimator = gasEstimator;

    this.createEmpContract = (empAddress) => {
      return new this.web3.eth.Contract(getAbi("ExpiringMultiParty"), empAddress);
    };

    // Formats an 18 decimal point string with a define number of decimals and precision for use in message generation.
    this.formatDecimalString = createFormatFunction(2, 4, false);

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

    // Default config settings. Bot deployer can override these settings by passing in new
    // values via the `optimisticOracleProposerConfig` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean.
    const defaultConfig = {
      disputePriceErrorPercent: {
        // `disputePricePrecisionOfError`: Proposal prices that differ from the dispute price
        //                                 more than this % error will be disputed. e.g. 0.05
        //                                 implies 5% margin of error from the historical price
        //                                 computed by the local pricefeed.
        value: 0.05,
        isValid: (x) => {
          return !isNaN(x);
          // Negative allowed-margins might be useful based on the implementation
          // of `isDeviationOutsideErrorMargin()`
        },
      },
      otherAccountsToSettle: {
        // `otherAccountsToSettle`: array of other accounts whose requests should be settled automatically.
        value: [],
        isValid: (x) => {
          // Must be a string array.
          return Array.isArray(x) && x.every((value) => typeof value === "string");
        },
      },
      settleAllRequests: {
        // `otherAccountsToSettle`: array of other accounts whose requests should be settled automatically.
        value: false,
        isValid: (x) => {
          // Must be a boolean.
          return typeof x === "boolean";
        },
      },
    };

    // Validate and set config settings to class state.
    const configWithDefaults = createObjectFromDefaultProps(optimisticOracleProposerConfig, defaultConfig);
    Object.assign(this, configWithDefaults);
  }

  async update() {
    await Promise.all([this.optimisticOracleClient.update(), this.gasEstimator.update()]);

    // Increase allowances for all relevant collateral currencies.
    await this._setAllowances();
  }

  // Submit proposals to unproposed price requests.
  async sendProposals() {
    this.logger.debug({
      at: "OptimisticOracleProposer#sendProposals",
      oracleType: this.optimisticOracleClient.oracleType,
      message: "Checking for unproposed price requests to send proposals for",
    });

    // TODO: Should allow user to filter out price requests with rewards below a threshold,
    // allowing the bot to prevent itself from being induced to unprofitably propose.
    for (let priceRequest of this.optimisticOracleClient.getUnproposedPriceRequests()) {
      if (await this._shouldIgnorePriceRequest(priceRequest)) continue;
      await this._sendProposal(priceRequest);
    }
  }

  // Submit disputes to proposed price requests.
  async sendDisputes() {
    this.logger.debug({
      at: "OptimisticOracleProposer#sendDisputes",
      oracleType: this.optimisticOracleClient.oracleType,
      message: "Checking for undisputed price requests to dispute",
    });

    for (let priceRequest of this.optimisticOracleClient.getUndisputedProposals()) {
      if (await this._shouldIgnorePriceRequest(priceRequest)) continue;
      await this._sendDispute(priceRequest);
    }
  }

  // Settle disputes where this bot was the disputer and proposals where this bot was the proposer.
  async settleRequests() {
    this.logger.debug({
      at: "OptimisticOracleProposer#settleRequests",
      oracleType: this.optimisticOracleClient.oracleType,
      message: "Checking for proposals and disputes to settle",
    });

    // If settleAllRequests is true, pass undefined, so it settles _any_ expired requests.
    const settleableAccounts = this.settleAllRequests ? undefined : [this.account, ...this.otherAccountsToSettle];
    const settleableRequests = this.optimisticOracleClient
      .getSettleableProposals(settleableAccounts)
      .concat(this.optimisticOracleClient.getSettleableDisputes(settleableAccounts));

    for (let priceRequest of settleableRequests) {
      await this._settleRequest(priceRequest);
    }
  }

  // Returns true if the price request should be ignored by the OO proposer + disputer for any reason, False otherwise.
  async _shouldIgnorePriceRequest(priceRequest) {
    // Ignore any identifier on the blacklist:
    if (this.ignoredIdentifiers.includes(priceRequest.identifier)) {
      this.logger.debug({
        at: "OptimisticOracleProposer#Proposer",
        message: "Identifier is blacklisted",
        identifier: priceRequest.identifier,
      });
      return true;
    }

    // If the price request is an expiry price request for a specific type of EMP
    // whose price resolution is self-referential pre-expiry and diferent post-expiry,
    // then skip the price request:
    if (this.ignoredIdentifiersPostExpiry.includes(priceRequest.identifier)) {
      // Check if (1) contract is an EMP and (2) EMP has expired:
      try {
        // The requester should be an EMP contract if this is an expiry price request.
        const empContract = this.createEmpContract(priceRequest.requester);
        const expirationTimestamp = await empContract.methods.expirationTimestamp().call();
        if (Number(priceRequest.timestamp) >= Number(expirationTimestamp)) {
          this.logger.debug({
            at: "OptimisticOracleProposer#Proposer",
            message: "EMP contract has expired and identifier's price resolution logic transforms post-expiry",
            identifier: priceRequest.identifier,
            expirationTimestamp: expirationTimestamp.toString(),
          });
          return true;
        }
      } catch (err) {
        // Do nothing, contract is probably not an EMP
      }
    }

    // All checks passed, should NOT ignore this price request:
    return false;
  }

  // Construct proposal transaction and send or return early if an error is encountered.
  async _sendProposal(priceRequest) {
    const priceFeed = await this._createOrGetCachedPriceFeed(priceRequest.identifier);

    // Pricefeed is either constructed correctly or is null.
    if (!priceFeed) {
      this.logger.error({
        at: "OptimisticOracleProposer#sendProposals",
        message: "Failed to construct a PriceFeed for price request 📛",
        priceRequest,
      });
      return;
    }

    // With pricefeed successfully constructed, get a proposal price
    await priceFeed.update();
    let proposalPrice;
    try {
      proposalPrice = (
        await priceFeed.getHistoricalPrice(Number(priceRequest.timestamp), priceRequest.ancillaryData)
      ).toString();
    } catch (error) {
      this.logger.error({
        at: "OptimisticOracleProposer#sendProposals",
        message: "Failed to query historical price for price request 📛",
        priceRequest,
        error,
      });
      return;
    }

    // Get successful transaction receipt and return value or error.
    let proposal;
    if (this.optimisticOracleClient.oracleType === OptimisticOracleType.SkinnyOptimisticOracle) {
      proposal = this.optimisticOracleContract.methods.proposePrice(
        priceRequest.requester,
        this.utf8ToHex(priceRequest.identifier),
        priceRequest.timestamp,
        priceRequest.ancillaryData,
        priceRequest.request,
        proposalPrice
      );
    } else {
      proposal = this.optimisticOracleContract.methods.proposePrice(
        priceRequest.requester,
        this.utf8ToHex(priceRequest.identifier),
        priceRequest.timestamp,
        priceRequest.ancillaryData,
        proposalPrice
      );
    }
    this.logger.debug({
      at: "OptimisticOracleProposer#sendProposals",
      message: "Detected price request, and proposing new price",
      oracleType: this.optimisticOracleClient.oracleType,
      priceRequest,
      potentialProposalPrice: proposalPrice,
      proposer: this.account,
    });
    try {
      const { receipt, returnValue, transactionConfig } = await runTransaction({
        web3: this.web3,
        transaction: proposal,
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
      });

      const logResult = {
        tx: receipt.transactionHash,
        // This is undefined unless the oracle type is SkinnyOptimisticOracle.
        ...receipt.events.ProposePrice.returnValues.request,
        ...receipt.events.ProposePrice.returnValues,
        identifier: this.hexToUtf8(receipt.events.ProposePrice.returnValues.identifier),
        ancillaryData: receipt.events.ProposePrice.returnValues.ancillaryData || "0x",
      };
      this.logger.info({
        at: "OptimisticOracleProposer#sendProposals",
        message: "Proposed price!💍",
        oracleType: this.optimisticOracleClient.oracleType,
        priceRequest,
        proposalBond: returnValue.toString(),
        proposalResult: logResult,
        transactionConfig,
      });
    } catch (error) {
      const message =
        error.type === "call"
          ? "Cannot propose price: not enough collateral (or large enough approval)✋"
          : "Failed to propose price🚨";
      this.logger.error({
        at: "OptimisticOracleProposer#sendProposals",
        oracleType: this.optimisticOracleClient.oracleType,
        message,
        priceRequest,
        error,
      });
      return;
    }
  }
  // Construct dispute transaction and send or return early if an error is encountered.
  async _sendDispute(priceRequest) {
    // Get proposal price
    let proposalPrice;
    if (this.optimisticOracleClient.oracleType === OptimisticOracleType.SkinnyOptimisticOracle)
      proposalPrice = priceRequest.request.proposedPrice;
    else proposalPrice = priceRequest.proposedPrice;

    // Create pricefeed for identifier
    const priceFeed = await this._createOrGetCachedPriceFeed(priceRequest.identifier);

    // Pricefeed is either constructed correctly or is null.
    if (!priceFeed) {
      this.logger.error({
        at: "OptimisticOracleProposer#sendDisputes",
        message: "Failed to construct a PriceFeed for price request 📛",
        priceRequest,
      });
      return;
    }

    // With pricefeed successfully constructed, confirm the proposal price
    await priceFeed.update();
    let disputePrice;
    try {
      disputePrice = (await priceFeed.getHistoricalPrice(Number(priceRequest.timestamp))).toString();
    } catch (error) {
      this.logger.error({
        at: "OptimisticOracleProposer#sendDisputes",
        message: "Failed to query historical price for price request 📛",
        priceRequest,
        error,
      });
      return;
    }

    // If proposal price is not equal to the dispute price within margin of error, then
    // prepare dispute. We're assuming that the `disputePrice` is the baseline or "expected"
    // price.
    let isPriceDisputable = isDeviationOutsideErrorMargin(
      this.toBN(proposalPrice.toString()), // ObservedValue
      this.toBN(disputePrice.toString()), // ExpectedValue
      this.toBN(this.toWei("1")),
      this.toBN(this.toWei(this.disputePriceErrorPercent.toString()))
    );
    if (isPriceDisputable) {
      // Get successful transaction receipt and return value or error.
      let dispute;
      if (this.optimisticOracleClient.oracleType === OptimisticOracleType.SkinnyOptimisticOracle) {
        dispute = this.optimisticOracleContract.methods.disputePrice(
          priceRequest.requester,
          this.utf8ToHex(priceRequest.identifier),
          priceRequest.timestamp,
          priceRequest.ancillaryData,
          priceRequest.request
        );
      } else {
        dispute = this.optimisticOracleContract.methods.disputePrice(
          priceRequest.requester,
          this.utf8ToHex(priceRequest.identifier),
          priceRequest.timestamp,
          priceRequest.ancillaryData
        );
      }
      this.logger.debug({
        at: "OptimisticOracleProposer#sendDisputes",
        message: "Disputing proposal",
        oracleType: this.optimisticOracleClient.oracleType,
        priceRequest,
        proposalPrice,
        disputePrice,
        allowedError: this.disputePriceErrorPercent,
        disputer: this.account,
      });
      try {
        const { receipt, returnValue, transactionConfig } = await runTransaction({
          web3: this.web3,
          transaction: dispute,
          transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
        });

        const logResult = {
          tx: receipt.transactionHash,
          // This is undefined unless the oracle type is SkinnyOptimisticOracle.
          ...receipt.events.DisputePrice.returnValues.request,
          ...receipt.events.DisputePrice.returnValues,
          identifier: this.hexToUtf8(receipt.events.DisputePrice.returnValues.identifier),
          ancillaryData: receipt.events.DisputePrice.returnValues.ancillaryData || "0x",
        };
        this.logger.info({
          at: "OptimisticOracleProposer#sendDisputes",
          message: "Disputed proposal!⛑",
          oracleType: this.optimisticOracleClient.oracleType,
          priceRequest,
          disputeBond: returnValue.toString(),
          allowedError: this.disputePriceErrorPercent,
          disputeResult: logResult,
          transactionConfig,
        });
      } catch (error) {
        const message =
          error.type === "call"
            ? "Cannot dispute price: not enough collateral (or large enough approval)✋"
            : "Failed to dispute proposal🚨";
        this.logger.error({
          at: "OptimisticOracleProposer#sendDisputes",
          message,
          oracleType: this.optimisticOracleClient.oracleType,
          priceRequest,
          error,
        });
        return;
      }
    } else {
      this.logger.debug({
        at: "OptimisticOracleProposer#sendDisputes",
        message: "Skipping dispute because proposal price is within allowed margin of error",
        priceRequest,
        proposalPrice,
        disputePrice,
        allowedError: this.disputePriceErrorPercent,
      });
    }
  }
  // Construct settlement transaction and send or return early if an error is encountered.
  async _settleRequest(priceRequest) {
    // Get successful transaction receipt and return value or error.
    let settle;
    if (this.optimisticOracleClient.oracleType === OptimisticOracleType.SkinnyOptimisticOracle) {
      settle = this.optimisticOracleContract.methods.settle(
        priceRequest.requester,
        this.utf8ToHex(priceRequest.identifier),
        priceRequest.timestamp,
        priceRequest.ancillaryData,
        priceRequest.request
      );
    } else {
      settle = this.optimisticOracleContract.methods.settle(
        priceRequest.requester,
        this.utf8ToHex(priceRequest.identifier),
        priceRequest.timestamp,
        priceRequest.ancillaryData
      );
    }

    this.logger.debug({
      at: "OptimisticOracleProposer#settleRequests",
      message: "Settling proposal or dispute",
      priceRequest,
    });
    try {
      const { receipt, returnValue } = await runTransaction({
        web3: this.web3,
        transaction: settle,
        transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
      });
      const mrkdwn =
        createEtherscanLinkMarkdown(
          this.optimisticOracleClient.oracleType === OptimisticOracleType.SkinnyOptimisticOracle
            ? receipt.events.Settle.returnValues.request.proposer
            : receipt.events.Settle.returnValues.proposer,
          this.chainId
        ) +
        " proposed a price of " +
        this.formatDecimalString(
          this.optimisticOracleClient.oracleType === OptimisticOracleType.SkinnyOptimisticOracle
            ? receipt.events.Settle.returnValues.request.proposedPrice
            : receipt.events.Settle.returnValues.price
        ) +
        " proposal for " +
        this.hexToUtf8(receipt.events.Settle.returnValues.identifier) +
        " at timestamp " +
        receipt.events.Settle.returnValues.timestamp +
        " with " +
        this._formatAncillaryData(receipt.events.Settle.returnValues.ancillaryData) +
        " which has been settled! proposer payout is " +
        this.formatDecimalString(
          this.optimisticOracleClient.oracleType === OptimisticOracleType.SkinnyOptimisticOracle
            ? returnValue.payout.toString()
            : returnValue.toString()
        ) +
        " tx: " +
        createEtherscanLinkMarkdown(receipt.transactionHash, this.chainId);
      this.logger.info({
        at: "OptimisticOracleProposer#settleRequests",
        message: `Settled ${
          receipt.events.Settle.returnValues.disputer === ZERO_ADDRESS ? "proposal 💍!" : "dispute ⛑!"
        }`,
        mrkdwn,
      });
    } catch (error) {
      console.log("error", error);
      const message =
        error.type === "call" ? "Cannot settle for unknown reason☹️" : "Failed to settle proposal or dispute🚨";
      this.logger.warn({ at: "OptimisticOracleProposer#settleRequests", message, priceRequest, error });
      return;
    }
  }
  // Sets allowances for all collateral currencies used in unproposed price requests
  async _setAllowances() {
    // TODO: Note we set allowances sequentially so that we can hardcode the nonce before passing
    // transactions to the `ynatm` package. If these calls were submitted in parallel then we wouldn't be able to
    // hardcode the nonce, which could cause unintended reverts due to duplicate transactions. Once the `ynatm` package
    // can handle nonce management, then we should update this logic to run in parallel.

    // The OptimisticOracle requires approval to transfer the proposed price request's collateral currency in order to
    // post a bond. We'll set this once to the max value and top up whenever the bot's allowance drops below
    // MAX_INT / 2. We also approve currencies stored in disputes if for some reason they were not approved already.
    const allPriceRequests = this.optimisticOracleClient
      .getUnproposedPriceRequests()
      .concat(this.optimisticOracleClient.getUndisputedProposals());
    for (let priceRequest of allPriceRequests) {
      if (await this._shouldIgnorePriceRequest(priceRequest)) continue;
      const collateralCurrencyAddress =
        this.optimisticOracleClient.oracleType === OptimisticOracleType.SkinnyOptimisticOracle
          ? priceRequest.request.currency
          : priceRequest.currency;
      const receipt = await setAllowance(
        this.web3,
        this.gasEstimator,
        this.account,
        this.optimisticOracleContract.options.address,
        collateralCurrencyAddress
      );
      if (receipt) {
        this.logger.info({
          at: "OptimisticOracle#Proposer",
          message: "Approved OptimisticOracle to transfer unlimited collateral tokens 💰",
          currency: receipt.currencyAddress,
          collateralApprovalTx: receipt.tx.transactionHash,
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
    this.logger.debug({
      at: "OptimisticOracleProposer",
      message: "Created pricefeed configuration for identifier",
      commonPriceFeedConfig: this.commonPriceFeedConfig,
      identifier,
    });

    // Create a new pricefeed for this identifier. We might consider caching these price requests
    // for re-use if any requests use the same identifier.
    let newPriceFeed = await createReferencePriceFeedForFinancialContract(
      this.logger,
      this.web3,
      new Networker(this.logger),
      () => Math.round(new Date().getTime() / 1000),
      null, // No EMP Address needed since we're passing identifier explicitly
      this.commonPriceFeedConfig,
      identifier
    );
    if (newPriceFeed) this.priceFeedCache[identifier] = newPriceFeed;
    return newPriceFeed;
  }

  _formatAncillaryData(ancillaryData) {
    try {
      // Return the decoded ancillary data as a string. The `replace` syntax removes any escaped quotes from the string.
      return "Ancillary data: " + JSON.stringify(parseAncillaryData(ancillaryData)).replace(/"/g, "");
    } catch (_) {
      try {
        // If that fails, try to return the ancillary data UTF-8 decoded.
        return "Ancillary data: " + this.web3.utils.hexToUtf8(ancillaryData);
      } catch (_) {
        return "Could not parse ancillary data nor UTF-8 decode: " + ancillaryData || "0x";
      }
    }
  }
}

module.exports = { OptimisticOracleProposer };
