const { Networker, createReferencePriceFeedForFinancialContract } = require("@uma/financial-templates-lib");
const { createObjectFromDefaultProps, MAX_UINT_VAL } = require("@uma/common");
const { getAbi } = require("@uma/core");

class FundingRateProposer {
  /**
   * @notice Constructs new Perpetual FundingRate Proposer bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} perpetualFactoryClient Module used to query for live perpetual contracts.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} commonPriceFeedConfig Default configuration to construct all price feed objects.
   * @param {Object} [perpetualProposerConfig] Contains fields with which constructor will attempt to override defaults.
   */
  constructor({
    logger,
    perpetualFactoryClient,
    gasEstimator,
    account,
    commonPriceFeedConfig,
    perpetualProposerConfig
  }) {
    this.logger = logger;
    this.account = account;
    this.perpetualFactoryClient = perpetualFactoryClient;
    this.web3 = this.perpetualFactoryClient.web3;
    this.commonPriceFeedConfig = commonPriceFeedConfig;

    this.createPerpetualContract = perpAddress => {
      return new this.web3.eth.Contract(getAbi("Perpetual"), perpAddress);
    };

    // Gas Estimator to calculate the current Fast gas rate.
    this.gasEstimator = gasEstimator;

    // Cached mapping of identifiers to pricefeed classes
    this.priceFeedCache = {};

    // Cached perpetual contracts
    this.contractCache = {};

    // Helper functions from web3.
    this.BN = this.web3.utils.BN;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.fromWei = this.web3.utils.fromWei;
    this.utf8ToHex = this.web3.utils.utf8ToHex;
    this.hexToUtf8 = this.web3.utils.hexToUtf8;

    // Default config settings. Bot deployer can override these settings by passing in new
    // values via the `perpetualProposerConfig` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean.
    const defaultConfig = {
      fundingRateErrorPercent: {
        //   "fundingRateErrorPercent":0.05 ->  Current funding rates (as stored in the OptimisticOracle)
        //                                      that do not equal the bot's queried funding rate
        //                                      within this error % will be requested to be updated,
        //                                      and proposed to.
        //                                      e.g. 0.05 implies 5% margin of error.
        value: 0.05,
        isValid: x => {
          return x >= 0 && x < 1;
        }
      }
    };

    // Validate and set config settings to class state.
    const configWithDefaults = createObjectFromDefaultProps(perpetualProposerConfig, defaultConfig);
    Object.assign(this, configWithDefaults);
  }

  async update() {
    await Promise.all([this.perpetualFactoryClient.update(), this.gasEstimator.update()]);

    // Once PerpFactory client is updated, cache contract instances for each address deployed.
    this._cachePerpetualContracts();

    // Increase allowances for all relevant collateral currencies.
    await this._setAllowances();
  }

  async updateFundingRates() {
    this.logger.debug({
      at: "PerpetualProposer#updateFundingRates",
      message: "Checking for contract funding rates to update",
      perpetualsChecked: Object.keys(this.contractCache)
    });

    // TODO: Should allow user to filter out price requests with rewards below a threshold,
    // allowing the bot to prevent itself from being induced to unprofitably propose.
    for (let contractAddress of Object.keys(this.contractCache)) {
      await this._updateFundingRate(contractAddress);
    }
  }

  /** **********************************
   *
   * INTERNAL METHODS
   *
   ************************************/

  // Check contract funding rates and request+propose to update them, or return early if an error is encountered.
  async _updateFundingRate(contractAddress) {
    // Fetch current funding rate data from contract
    const currentFundingRateData = await this.contractCache[contractAddress].methods.fundingRate().call({
      from: this.account,
      gasPrice: this.gasEstimator.getCurrentFastPrice()
    });
    const fundingRateIdentifier = this.hexToUtf8(currentFundingRateData.identifier);
    const priceFeed = await this._createOrGetCachedPriceFeed(fundingRateIdentifier);

    // Pricefeed is either constructed correctly or is null.
    if (!priceFeed) {
      this.logger.error({
        at: "PerpetualProposer#updateFundingRates",
        message: "Failed to construct a PriceFeed for funding rate identifier",
        fundingRateIdentifier
      });
      return;
    }

    // With pricefeed successfully constructed, get the current funding rate
    await priceFeed.update();
    let offchainFundingRate = priceFeed.getCurrentPrice().toString();
    if (!offchainFundingRate) {
      this.logger.error({
        at: "PerpetualProposer#updateFundingRate",
        message: "Failed to query current price for funding rate identifier",
        fundingRateIdentifier
      });
      return;
    }
  }
  // Sets allowances for all collateral currencies used live perpetual contracts.
  async _setAllowances() {
    const approvalPromises = [];

    // Increase `perpetualAddress` allowance to MAX for the collateral @ `currencyAddress`
    const _approveCollateralCurrency = async (currencyAddress, perpetualAddress) => {
      const collateralToken = new this.web3.eth.Contract(getAbi("ExpandedERC20"), currencyAddress);
      const currentCollateralAllowance = await collateralToken.methods.allowance(this.account, perpetualAddress).call({
        from: this.account,
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      });
      if (this.toBN(currentCollateralAllowance).lt(this.toBN(MAX_UINT_VAL).div(this.toBN("2")))) {
        const collateralApprovalPromise = collateralToken.methods
          .approve(perpetualAddress, MAX_UINT_VAL)
          .send({
            from: this.account,
            gasPrice: this.gasEstimator.getCurrentFastPrice()
          })
          .then(tx => {
            this.logger.info({
              at: "PerpetualProposer",
              message: "Approved Perpetual contract to transfer unlimited collateral tokens 💰",
              perpetual: perpetualAddress,
              currency: currencyAddress,
              collateralApprovalTx: tx.transactionHash
            });
          });
        approvalPromises.push(collateralApprovalPromise);
      }
    };

    // The Perpetual requires approval to transfer the contract's collateral currency in order to post a bond.
    // We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
    for (let contractAddress of Object.keys(this.contractCache)) {
      const collateralAddress = await this.contractCache[contractAddress].methods.collateralCurrency().call({
        from: this.account,
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      });
      await _approveCollateralCurrency(collateralAddress, contractAddress);
    }

    await Promise.all(approvalPromises);
  }

  // Create the pricefeed for a specific identifier and save it to the state, or
  // return the saved pricefeed if already constructed.
  async _createOrGetCachedPriceFeed(identifier) {
    // First check for cached pricefeed for this identifier and return it if exists:
    let priceFeed = this.priceFeedCache[identifier];
    if (priceFeed) return priceFeed;
    this.logger.debug({
      at: "PerpetualProposer",
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
      this.commonPriceFeedConfig,
      identifier
    );
    if (newPriceFeed) this.priceFeedCache[identifier] = newPriceFeed;
    return newPriceFeed;
  }

  // Create contract object for each perpetual address created. Addresses fetched from PerpFactoryEventClient.
  _cachePerpetualContracts() {
    for (let creationEvent of this.perpetualFactoryClient.getAllCreatedContractEvents()) {
      if (!this.contractCache[creationEvent.contractAddress]) {
        // Failure to construct a Perpetual instance using the contract address should be fatal,
        // so we don't catch that error.
        const perpetualContract = this.createPerpetualContract(creationEvent.contractAddress);
        this.contractCache[creationEvent.contractAddress] = perpetualContract;
      }
    }
  }
}

module.exports = {
  FundingRateProposer
};
