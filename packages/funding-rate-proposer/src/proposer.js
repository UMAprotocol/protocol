const {
  Networker,
  createReferencePriceFeedForFinancialContract,
  setAllowance,
  isDeviationOutsideErrorMargin
} = require("@uma/financial-templates-lib");
const { createObjectFromDefaultProps, runTransaction } = require("@uma/common");
const { getAbi } = require("@uma/core");
const Promise = require("bluebird");

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
    this.createConfigStoreContract = storeAddress => {
      return new this.web3.eth.Contract(getAbi("ConfigStore"), storeAddress);
    };

    // Gas Estimator to calculate the current Fast gas rate.
    this.gasEstimator = gasEstimator;

    // Cached mapping of identifiers to pricefeed classes.
    this.priceFeedCache = {};

    // Cached perpetual contracts and precomputed state.
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
          return !isNaN(x);
          // Negative allowed-margins might be useful based on the implementation
          // of `isDeviationOutsideErrorMargin()`
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
    // These will be saved to this.contractCache. Additionally, precompute state that we'll
    // use in `updateFundingRates()` such as the latest funding rates and config store settings.
    await this._cachePerpetualContracts();

    // The following updates can be done independently after contract state is fetched:
    await Promise.all([
      // Increase allowances for all contracts to spend the bot owner's respective collateral currency.
      this._setAllowances(),
      // For each contract, create, save, and update a pricefeed instance for its identifier,
      // or just update the pricefeed if the identifier already has cached an instance.
      this._cacheAndUpdatePriceFeeds()
    ]);
  }

  async updateFundingRates() {
    this.logger.debug({
      at: "PerpetualProposer#updateFundingRates",
      message: "Checking for contract funding rates to update",
      perpetualsChecked: Object.keys(this.contractCache)
    });

    // TODO: Should allow user to set an ROI-based metric to customize whether
    // bot strategically waits to submit funding rate proposals. Rewards
    // increase with time since last update.
    await Promise.map(Object.keys(this.contractCache), contractAddress => {
      return this._updateFundingRate(contractAddress);
    });
  }

  /** **********************************
   *
   * INTERNAL METHODS
   *
   ************************************/

  // Check contract funding rates and request+propose to update them, or return early if an error is encountered.
  async _updateFundingRate(contractAddress) {
    const cachedContract = this.contractCache[contractAddress];
    const currentFundingRateData = cachedContract.state.currentFundingRateData;
    const currentConfig = cachedContract.state.currentConfig;
    const fundingRateIdentifier = this.hexToUtf8(currentFundingRateData.identifier);

    // If proposal time is not 0, then proposal is already outstanding. Check if
    // the proposal has been disputed and if not, then we can't propose and must exit.
    const proposalTime = currentFundingRateData.proposalTime.toString();
    if (proposalTime !== "0") {
      this.logger.debug({
        at: "PerpetualProposer#updateFundingRate",
        message: "Proposal is already pending, cannot propose",
        fundingRateIdentifier,
        proposalTime
      });
      return;
    }

    // Assume pricefeed has been cached and updated prior to this function via the `update()` call.
    const priceFeed = this.priceFeedCache[fundingRateIdentifier];
    if (!priceFeed) {
      this.logger.error({
        at: "PerpetualProposer#updateFundingRate",
        message: "Failed to create pricefeed for funding rate identifier",
        fundingRateIdentifier
      });
      return;
    }
    let offchainFundingRate = priceFeed.getCurrentPrice();
    if (!offchainFundingRate) {
      this.logger.error({
        at: "PerpetualProposer#updateFundingRate",
        message: "Failed to query current price for funding rate identifier",
        fundingRateIdentifier
      });
      return;
    }
    offchainFundingRate = offchainFundingRate.toString();
    let onchainFundingRate = currentFundingRateData.rate.toString();

    // Check that offchainFundingRate is within [configStore.minFundingRate, configStore.maxFundingRate]
    const minFundingRate = currentConfig.minFundingRate.toString();
    const maxFundingRate = currentConfig.maxFundingRate.toString();
    if (
      this.toBN(offchainFundingRate).lt(this.toBN(minFundingRate)) ||
      this.toBN(offchainFundingRate).gt(this.toBN(maxFundingRate))
    ) {
      this.logger.error({
        at: "PerpetualProposer#updateFundingRate",
        message: "Potential proposed funding rate is outside allowed funding rate range",
        fundingRateIdentifier,
        minFundingRate,
        maxFundingRate,
        offchainFundingRate
      });
      return;
    }

    // If the saved funding rate is not equal to the current funding rate within margin of error, then
    // prepare request to update. We're assuming that the `offchainFundingRate` is the baseline or "expected"
    // price.
    let shouldUpdateFundingRate = isDeviationOutsideErrorMargin(
      this.toBN(onchainFundingRate), // ObservedValue
      this.toBN(offchainFundingRate), // ExpectedValue
      this.toBN(this.toWei("1")),
      this.toBN(this.toWei(this.fundingRateErrorPercent.toString()))
    );
    if (shouldUpdateFundingRate) {
      // Get successful transaction receipt and return value or error.
      const requestTimestamp = priceFeed.getLastUpdateTime();
      const proposal = cachedContract.contract.methods.proposeFundingRate(
        { rawValue: offchainFundingRate },
        requestTimestamp
      );
      this.logger.debug({
        at: "PerpetualProposer#updateFundingRate",
        message: "Proposing new funding rate",
        fundingRateIdentifier,
        requestTimestamp,
        proposedRate: offchainFundingRate,
        currentRate: onchainFundingRate,
        allowedError: this.fundingRateErrorPercent,
        proposer: this.account
      });
      try {
        const transactionResult = await runTransaction({
          transaction: proposal,
          config: {
            gasPrice: this.gasEstimator.getCurrentFastPrice(),
            from: this.account
          }
        });
        let receipt = transactionResult.receipt;
        let returnValue = transactionResult.returnValue.toString();

        const logResult = {
          tx: receipt.transactionHash,
          requester: contractAddress,
          proposer: this.account,
          fundingRateIdentifier,
          requestTimestamp,
          proposedRate: offchainFundingRate,
          currentRate: onchainFundingRate,
          proposalBond: returnValue
        };
        this.logger.info({
          at: "PerpetualProposer#updateFundingRate",
          message: "Proposed new funding rate!🌻",
          proposalBond: returnValue,
          proposalResult: logResult
        });
      } catch (error) {
        const message =
          error.type === "call"
            ? "Cannot propose funding rate: not enough collateral (or large enough approval)✋"
            : "Failed to propose funding rate🚨";
        this.logger.error({
          at: "PerpetualProposer#updateFundingRate",
          message,
          fundingRateIdentifier,
          error
        });
        return;
      }
    } else {
      this.logger.debug({
        at: "PerpetualProposer#updateFundingRate",
        message: "Skipping proposal because current rate is within allowed margin of error",
        fundingRateIdentifier,
        proposedRate: offchainFundingRate,
        currentRate: onchainFundingRate,
        allowedError: this.fundingRateErrorPercent
      });
    }
  }
  // Sets allowances for all collateral currencies used live perpetual contracts.
  async _setAllowances() {
    await Promise.map(Object.keys(this.contractCache), async contractAddress => {
      // The Perpetual requires approval to transfer the contract's collateral currency in order to post a bond.
      // We'll set this once to the max value and top up whenever the bot's allowance drops below MAX_INT / 2.
      const receipt = await setAllowance(
        this.web3,
        this.gasEstimator,
        this.account,
        contractAddress,
        this.contractCache[contractAddress].collateralAddress
      );
      // receipt is null if allowance transaction was not sent, for example because allowance is already high enough.
      if (receipt) {
        this.logger.info({
          at: "PerpetualProposer",
          message: "Approved Perpetual contract to transfer unlimited collateral tokens 💰",
          perpetual: receipt.spenderAddress,
          currency: receipt.currencyAddress,
          collateralApprovalTx: receipt.tx.transactionHash
        });
      }
    });
  }

  async _cacheAndUpdatePriceFeeds() {
    await Promise.map(Object.keys(this.contractCache), async contractAddress => {
      const fundingRateIdentifier = this.hexToUtf8(
        this.contractCache[contractAddress].state.currentFundingRateData.identifier
      );
      let priceFeed = this.priceFeedCache[fundingRateIdentifier];
      if (!priceFeed) {
        this.logger.debug({
          at: "PerpetualProposer",
          message: "Caching new pricefeed for identifier",
          commonPriceFeedConfig: this.commonPriceFeedConfig,
          fundingRateIdentifier
        });

        // Create a new pricefeed for this identifier. We might consider caching these price requests
        // for re-use if any requests use the same identifier.
        priceFeed = await createReferencePriceFeedForFinancialContract(
          this.logger,
          this.web3,
          new Networker(this.logger),
          () => Math.round(new Date().getTime() / 1000),
          null, // No EMP Address needed since we're passing identifier explicitly
          this.commonPriceFeedConfig,
          fundingRateIdentifier
        );
        this.priceFeedCache[fundingRateIdentifier] = priceFeed;
      }

      // If pricefeed was created or fetched from cache, update it
      if (priceFeed) {
        await priceFeed.update();
      }
    });
  }

  // Create contract object for each perpetual address created. Addresses fetched from PerpFactoryEventClient.
  // Fetch and cache latest contract state.
  async _cachePerpetualContracts() {
    await Promise.map(this.perpetualFactoryClient.getAllCreatedContractAddresses(), async contractAddress => {
      if (!this.contractCache[contractAddress]) {
        this.logger.debug({
          at: "PerpetualProposer",
          message: "Caching new perpetual contract",
          perpetualAddress: contractAddress
        });
        // Failure to construct a Perpetual instance using the contract address should be fatal,
        // so we don't catch that error.
        const perpetualContract = this.createPerpetualContract(contractAddress);

        // Fetch contract state that we won't need to refresh, such as collateral currency:
        const collateralAddress = await perpetualContract.methods.collateralCurrency().call();

        this.contractCache[contractAddress] = {
          contract: perpetualContract,
          collateralAddress
        };
      }
      // For this contract, load state.
      await this._getContractState(contractAddress);
    });
  }

  // Publish pending funding rate proposals to contract state and fetch updated state.
  async _getContractState(contractAddress) {
    let perpetualContract = this.contractCache[contractAddress].contract;

    // Grab on-chain state in parallel.
    const [currentFundingRateData, configStoreAddress] = await Promise.all([
      perpetualContract.methods.fundingRate().call(),
      perpetualContract.methods.configStore().call()
    ]);
    const configStoreContract = this.createConfigStoreContract(configStoreAddress);
    // Grab config store settings.
    const [currentConfig] = await Promise.all([configStoreContract.methods.updateAndGetCurrentConfig().call()]);

    // Save contract state to cache:
    this.contractCache[contractAddress] = {
      ...this.contractCache[contractAddress],
      state: {
        currentFundingRateData,
        currentConfig
      }
    };
  }
}

module.exports = {
  FundingRateProposer
};
