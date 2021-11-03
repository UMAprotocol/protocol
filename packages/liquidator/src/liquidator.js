const {
  PostWithdrawLiquidationRewardsStatusTranslations,
  createObjectFromDefaultProps,
  revertWrapper,
  runTransaction,
} = require("@uma/common");

const LiquidationStrategy = require("./liquidationStrategy");

class Liquidator {
  /**
   * @notice Constructs new Liquidator bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} financialContractClient Module used to query Financial Contract information on-chain.
   * @param {Object} proxyTransactionWrapper Module enable the liquidator to send transactions via a DSProxy.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {Object} syntheticToken Synthetic token (tokenCurrency).
   * @param {Object} priceFeed Module used to query the current token price.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} financialContractProps Contains Financial Contract contract state data. Expected:
   *      { crRatio: 1.5e18,
            minSponsorSize: 10e18,
            priceIdentifier: hex("ETH/BTC") }
   * @param {Object} [liquidatorConfig] Contains fields with which constructor will attempt to override defaults.
   */
  constructor({
    logger,
    financialContractClient,
    proxyTransactionWrapper,
    gasEstimator,
    syntheticToken,
    priceFeed,
    account,
    financialContractProps,
    liquidatorConfig,
  }) {
    this.logger = logger;
    this.account = account;

    this.proxyTransactionWrapper = proxyTransactionWrapper;

    // Expiring multiparty contract to read contract state
    this.financialContractClient = financialContractClient;
    this.web3 = this.financialContractClient.web3;

    // Gas Estimator to calculate the current Fast gas rate.
    this.gasEstimator = gasEstimator;

    // Instance of the expiring multiparty to perform on-chain liquidations.
    this.financialContract = this.financialContractClient.financialContract;
    this.syntheticToken = syntheticToken;

    // Instance of the price feed to get the realtime token price.
    this.priceFeed = priceFeed;

    // The Financial Contract contract collateralization Ratio is needed to calculate minCollateralPerToken.
    this.financialContractCRRatio = financialContractProps.crRatio;

    // The Financial Contract contract min sponsor position size is needed to calculate maxTokensToLiquidate.
    this.financialContractMinSponsorSize = financialContractProps.minSponsorSize;

    this.financialContractIdentifier = financialContractProps.priceIdentifier;

    // Helper functions from web3.
    this.BN = this.web3.utils.BN;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.fromWei = this.web3.utils.fromWei;
    this.utf8ToHex = this.web3.utils.utf8ToHex;

    // Default config settings. Liquidator deployer can override these settings by passing in new
    // values via the `liquidatorConfig` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean.
    const defaultConfig = {
      crThreshold: {
        // `crThreshold`: If collateral falls more than `crThreshold` % below the min collateral requirement,
        // then it will be liquidated. For example: If the minimum collateralization ratio is 120% and the TRV is 100,
        // then the minimum collateral requirement is 120. However, if `crThreshold = 0.02`, then the minimum
        // collateral requirement is 120 * (1-0.02) = 117.6, or 2% below 120.
        value: 0.02,
        isValid: (x) => {
          return x < 1 && x >= 0;
        },
      },
      liquidationDeadline: {
        // `liquidationDeadline`: Aborts the liquidation if the transaction is mined this amount of time after the
        // Financial Contract client's last update time. Denominated in seconds, so 300 = 5 minutes.
        value: 300,
        isValid: (x) => {
          return x >= 0;
        },
      },
      liquidationMinPrice: {
        // `liquidationMinPrice`: Aborts the liquidation if the amount of collateral in the position per token
        // outstanding is below this ratio.
        value: this.toWei("0"),
        isValid: (x) => {
          return this.toBN(x).gte(this.toBN("0"));
        },
        // TODO: We should specify as a percentage of the token price so that no valid
        // liquidation would ever lose money.
      },
      txnGasLimit: {
        // `txnGasLimit`: Gas limit to set for sending on-chain transactions.
        value: 9000000, // Can see recent averages here: https://etherscan.io/chart/gaslimit
        isValid: (x) => {
          return x >= 6000000 && x < 15000000;
        },
      },
      logOverrides: {
        // Specify an override object to change default logging behaviour. Defaults to no overrides. If specified, this
        // object is structured to contain key for the log to override and value for the logging level. EG:
        // { positionLiquidated:'warn' } would override the default `info` behaviour for liquidationEvents.
        value: {},
        isValid: (overrides) => {
          // Override must be one of the default logging levels: ['error','warn','info','http','verbose','debug','silly']
          return Object.values(overrides).every((param) => Object.keys(this.logger.levels).includes(param));
        },
      },
      defenseActivationPercent: {
        value: undefined,
        isValid: (x) => {
          if (x === undefined) return true;
          return parseFloat(x) >= 0 && parseFloat(x) <= 100;
        },
      },
      contractType: {
        value: undefined,
        isValid: (x) => {
          return x === "ExpiringMultiParty" || x === "Perpetual";
        },
      },
      contractVersion: {
        value: undefined,
        isValid: (x) => {
          return x === "2.0.1";
        },
      },
      // Start and end block define a window used to filter for contract events.
      startingBlock: {
        value: undefined,
        isValid: (x) => {
          if (x === undefined) return true;
          return Number(x) >= 0;
        },
      },
      endingBlock: {
        value: undefined,
        isValid: (x) => {
          if (x === undefined) return true;
          return Number(x) >= 0;
        },
      },
    };

    // Validate and set config settings to class state.
    const configWithDefaults = createObjectFromDefaultProps(liquidatorConfig, defaultConfig);
    Object.assign(this, configWithDefaults);

    // generalize log emitter, use it to attach default data to all logs
    const log = (severity = "info", data = {}) => {
      // would rather just throw here and let index.js capture and log, but
      // its currently not set up to add in the additional context for the error
      // so it has to be done here.
      if (logger[severity] === null) {
        return logger.error({
          at: "Liquidator",
          ...data,
          error: "Trying to submit log with unknown severity: " + severity,
        });
      }
      return logger[severity]({
        at: "Liquidator",
        // could add in additional context for any error thrown,
        // such as state of financialContract or bot configuration data
        minLiquidationPrice: this.liquidationMinPrice,
        ...data,
      });
    };
    this.log = log;

    // this takes in config, and emits log events
    this.liquidationStrategy = LiquidationStrategy(
      { ...configWithDefaults, ...financialContractProps },
      this.web3.utils,
      log
    );
  }

  // Update the financialContractClient, gasEstimator and price feed. If a client has recently updated then it will do nothing.
  async update() {
    await Promise.all([this.financialContractClient.update(), this.gasEstimator.update(), this.priceFeed.update()]);
  }
  // Queries underCollateralized positions and performs liquidations against any under collateralized positions.
  // If `maxTokensToLiquidateWei` is not passed in, then the bot will attempt to liquidate the full position.
  // If liquidatorOverridePrice is provided then the liquidator bot will override the price feed with this input price.
  async liquidatePositions(maxTokensToLiquidateWei, liquidatorOverridePrice) {
    this.logger.debug({
      at: "Liquidator",
      message: "Checking for liquidatable positions and performing liquidations",
      maxTokensToLiquidateWei,
      liquidatorOverridePrice,
    });
    // If an override is provided, use that price. Else, get the latest price from the price feed.
    const price = liquidatorOverridePrice
      ? this.toBN(liquidatorOverridePrice.toString())
      : this.priceFeed.getCurrentPrice();

    if (!price) {
      throw new Error("Cannot liquidate: price feed returned invalid value");
    }

    // The `price` is a BN that is used to determine if a position is liquidatable. The higher the
    // `price` value, the more collateral that the position is required to have to be correctly collateralized.
    // Therefore, we add a buffer by deriving scaledPrice = price * (1 - crThreshold)
    const scaledPrice = price
      .mul(this.toBN(this.toWei("1")).sub(this.toBN(this.toWei(this.crThreshold.toString()))))
      .div(this.toBN(this.toWei("1")));

    // Calculate the maxCollateralPerToken as the scaled price, multiplied by the contracts CRRatio. For a liquidation
    // to be accepted by the contract the position's collateralization ratio must be between [minCollateralPerToken,
    // maxCollateralPerToken] ∴ maxCollateralPerToken >= startCollateralNetOfWithdrawal / startTokens. This criterion
    // checks for a positions correct capitalization, not collateralization. In order to liquidate a position that is
    // under collaterelaized (but over capitalized) The CR ratio needs to be included in the maxCollateralPerToken.
    const maxCollateralPerToken = this.toBN(scaledPrice)
      .mul(this.toBN(this.financialContractCRRatio))
      .mul(this.financialContractClient.getLatestCumulativeFundingRateMultiplier())
      .div(this.toBN(this.toWei("1")).mul(this.toBN(this.toWei("1"))));

    this.logger.debug({
      at: "Liquidator",
      message: "Checking for under collateralized positions",
      liquidatorOverridePrice: liquidatorOverridePrice ? liquidatorOverridePrice.toString() : null,
      latestCumulativeFundingRateMultiplier: this.financialContractClient
        .getLatestCumulativeFundingRateMultiplier()
        .toString(),
      inputPrice: price.toString(),
      scaledPrice: scaledPrice.toString(),
      financialContractCRRatio: this.financialContractCRRatio.toString(),
      maxCollateralPerToken: maxCollateralPerToken.toString(),
      crThreshold: this.crThreshold,
    });

    // Get the latest undercollateralized positions from the client.
    const underCollateralizedPositions = this.financialContractClient.getUnderCollateralizedPositions(scaledPrice);

    if (underCollateralizedPositions.length === 0) {
      this.logger.debug({ at: "Liquidator", message: "No undercollateralized position" });
      return;
    }

    for (const position of underCollateralizedPositions) {
      this.logger.debug({
        at: "Liquidator",
        message: "Detected a liquidatable position",
        scaledPrice: scaledPrice.toString(),
        maxCollateralPerToken: maxCollateralPerToken.toString(),
        position: position,
      });

      if (
        position.sponsor ==
        (this.proxyTransactionWrapper.useDsProxyToLiquidate
          ? this.proxyTransactionWrapper.dsProxyManager.getDSProxyAddress()
          : this.account)
      ) {
        this.logger.warn({
          at: "Liquidator",
          message: "The liquidator has an open position that is liquidatable! Bot will not liquidate itself! 😟",
          scaledPrice: scaledPrice.toString(),
          maxCollateralPerToken: maxCollateralPerToken.toString(),
          position: position,
        });
        continue;
      }
      // Note: query the time again during each iteration to ensure the deadline is set reasonably.
      const currentBlockTime = this.financialContractClient.getLastUpdateTime();

      // TODO: right now the `processPosition` method takes in maxTokensToLiquidateWei and syntheticTokenBalance. These
      // numbers are the same thing in production as the index file sets the maxTokensToLiquidateWei as the synthetic
      // token balance. This should be refactored (and simplified) to not repeat the same variable over and over.
      const syntheticTokenBalance = await this.proxyTransactionWrapper.getEffectiveSyntheticTokenBalance();

      // run strategy based on configs and current state
      // will return liquidation arguments or nothing
      // if it returns nothing it means this position cant be or shouldnt be liquidated
      const liquidationArgs = this.liquidationStrategy.processPosition({
        position, // position is assumed to be undercollateralized
        syntheticTokenBalance, // need to know our current balance to know how much to save for defense fund
        currentBlockTime, // this is required to create liquidation object
        maxCollateralPerToken, // maximum tokens we can liquidate in position
        maxTokensToLiquidateWei,
        inputPrice: scaledPrice.toString(), // for logging
      });

      // we couldnt liquidate, this typically would only happen if our balance is 0 or the withdrawal liveness
      // has not passed the WDF's activation threshold.
      if (!liquidationArgs) continue;

      // pulls the tokens to liquidate parameter out of the liquidation arguments
      const tokensToLiquidate = this.toBN(liquidationArgs[3].rawValue);

      // Send an alert if the bot is going to submit a partial liquidation instead of a full liquidation.
      if (tokensToLiquidate.lt(this.toBN(position.numTokens))) {
        this.logger.error({
          at: "Liquidator",
          message: "Submitting a partial liquidation: not enough synthetic to initiate full liquidation⚠️",
          sponsor: position.sponsor,
          inputPrice: scaledPrice.toString(),
          position: position,
          minLiquidationPrice: this.liquidationMinPrice,
          maxLiquidationPrice: maxCollateralPerToken.toString(),
          tokensToLiquidate: tokensToLiquidate.toString(),
          syntheticTokenBalance: syntheticTokenBalance.toString(),
          maxTokensToLiquidateWei: maxTokensToLiquidateWei ? maxTokensToLiquidateWei.toString() : null,
        });
      }
      this.logger.debug({
        at: "Liquidator",
        message: "Liquidating position",
        position,
        inputPrice: scaledPrice.toString(),
        minLiquidationPrice: this.liquidationMinPrice,
        maxLiquidationPrice: maxCollateralPerToken.toString(),
        tokensToLiquidate: tokensToLiquidate.toString(),
      });
      const logResult = await this.proxyTransactionWrapper.submitLiquidationTransaction(liquidationArgs);

      if (logResult instanceof Error || !logResult)
        this.logger.error({ at: "Liquidator", message: "Failed to liquidate position🚨", logResult });
      else
        this.logger[this.logOverrides.positionLiquidated || "info"]({
          at: "Liquidator",
          message: "Position has been liquidated!🔫",
          position: position,
          inputPrice: scaledPrice.toString(),
          liquidationResult: logResult,
        });
    }
  }

  // Queries ongoing liquidations and attempts to withdraw rewards from both expired and disputed liquidations.
  async withdrawRewards() {
    this.logger.debug({
      at: "Liquidator",
      message: "Checking for expired and disputed liquidations to withdraw rewards from",
    });

    // All of the liquidations that we could withdraw rewards from are drawn from the pool of
    // expired and disputed liquidations.
    const expiredLiquidations = this.financialContractClient.getExpiredLiquidations();
    const disputedLiquidations = this.financialContractClient.getDisputedLiquidations();

    // The liquidator address is either the DSProxy (if using a DSProxy to liquidate) or the unlocked account.
    const liquidatorAddress = this.proxyTransactionWrapper.useDsProxyToLiquidate
      ? this.proxyTransactionWrapper.dsProxyManager.getDSProxyAddress()
      : this.account;
    const potentialWithdrawableLiquidations = expiredLiquidations
      .concat(disputedLiquidations)
      .filter((liquidation) => liquidation.liquidator === liquidatorAddress);

    if (potentialWithdrawableLiquidations.length === 0) {
      this.logger.debug({ at: "Liquidator", message: "No withdrawable liquidations" });
      return;
    }

    for (const liquidation of potentialWithdrawableLiquidations) {
      this.logger.debug({
        at: "Liquidator",
        message: "Detected a pending or expired liquidation",
        liquidation: liquidation,
      });

      // Construct transaction.
      const withdraw = this.financialContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor);

      // Confirm that liquidation has eligible rewards to be withdrawn.
      let withdrawalCallResponse;
      try {
        withdrawalCallResponse = await withdraw.call({ from: this.account });

        // Mainnet view/pure functions sometimes don't revert, even if a require is not met. The revertWrapper ensures this
        // caught correctly. see https://forum.openzeppelin.com/t/require-in-view-pure-functions-dont-revert-on-public-networks/1211
        if (revertWrapper(withdrawalCallResponse) === null) {
          throw new Error("Simulated reward withdrawal failed");
        }
      } catch (error) {
        this.logger.debug({ at: "Liquidator", message: "No rewards to withdraw", liquidation: liquidation, error });
        continue;
      }

      // Returns an object containing all payouts.
      const amountWithdrawn = withdrawalCallResponse.payToLiquidator.rawValue.toString();
      this.logger.debug({
        at: "Liquidator",
        message: "Withdrawing liquidation",
        liquidation: liquidation,
        amountWithdrawn,
      });

      // Send the transaction or report failure.

      try {
        const { receipt, transactionConfig } = await runTransaction({
          web3: this.web3,
          transaction: withdraw,
          transactionConfig: { ...this.gasEstimator.getCurrentFastPrice(), from: this.account },
        });

        const logResult = {
          tx: receipt.transactionHash,
          caller: receipt.events.LiquidationWithdrawn.returnValues.caller,
          // Settlement price is possible undefined if liquidation expired without a dispute.
          settlementPrice: receipt.events.LiquidationWithdrawn.returnValues.settlementPrice,
          liquidationStatus:
            PostWithdrawLiquidationRewardsStatusTranslations[
              receipt.events.LiquidationWithdrawn.returnValues.liquidationStatus
            ],
        };

        // Returns an object containing all payouts.
        logResult.paidToLiquidator = receipt.events.LiquidationWithdrawn.returnValues.paidToLiquidator;
        logResult.paidToDisputer = receipt.events.LiquidationWithdrawn.returnValues.paidToDisputer;
        logResult.paidToSponsor = receipt.events.LiquidationWithdrawn.returnValues.paidToSponsor;

        this.logger.info({
          at: "Liquidator",
          message: "Liquidation withdrawn🤑",
          liquidation: liquidation,
          liquidationResult: logResult,
          transactionConfig,
        });
      } catch (error) {
        this.logger.error({ at: "Liquidator", message: "Failed to withdraw liquidation rewards🚨", error });
        continue;
      }
    }
  }
}

module.exports = { Liquidator };
