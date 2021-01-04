const ynatm = require("@umaprotocol/ynatm");

const {
  PostWithdrawLiquidationRewardsStatusTranslations,
  createObjectFromDefaultProps,
  revertWrapper
} = require("@uma/common");

const LiquidationStrategy = require("./liquidationStrategy");

class Liquidator {
  /**
   * @notice Constructs new Liquidator bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} expiringMultiPartyClient Module used to query EMP information on-chain.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {Object} votingContract DVM to query price requests.
   * @param {Object} syntheticToken Synthetic token (tokenCurrency).
   * @param {Object} priceFeed Module used to query the current token price.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} [config] Contains fields with which constructor will attempt to override defaults.
   * @param {Object} empProps Contains EMP contract state data. Expected:
   *      { crRatio: 1.5e18,
            minSponsorSize: 10e18,
            priceIdentifier: hex("ETH/BTC") }
   * @param {Object} [config] Contains fields with which constructor will attempt to override defaults.
   */
  constructor({
    logger,
    expiringMultiPartyClient,
    gasEstimator,
    votingContract,
    syntheticToken,
    priceFeed,
    account,
    empProps,
    config
  }) {
    this.logger = logger;
    this.account = account;

    // Expiring multiparty contract to read contract state
    this.empClient = expiringMultiPartyClient;
    this.web3 = this.empClient.web3;

    // Gas Estimator to calculate the current Fast gas rate.
    this.gasEstimator = gasEstimator;

    // Instance of the expiring multiparty to perform on-chain liquidations.
    this.empContract = this.empClient.emp;
    this.votingContract = votingContract;
    this.syntheticToken = syntheticToken;

    // Instance of the price feed to get the realtime token price.
    this.priceFeed = priceFeed;

    // The EMP contract collateralization Ratio is needed to calculate minCollateralPerToken.
    this.empCRRatio = empProps.crRatio;

    // The EMP contract min sponsor position size is needed to calculate maxTokensToLiquidate.
    this.empMinSponsorSize = empProps.minSponsorSize;

    this.empIdentifier = empProps.priceIdentifier;

    // Helper functions from web3.
    this.BN = this.web3.utils.BN;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.fromWei = this.web3.utils.fromWei;
    this.utf8ToHex = this.web3.utils.utf8ToHex;

    // Multiplier applied to Truffle's estimated gas limit for a transaction to send.
    this.GAS_LIMIT_BUFFER = 1.25;

    // Default config settings. Liquidator deployer can override these settings by passing in new
    // values via the `config` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean.
    const defaultConfig = {
      crThreshold: {
        // `crThreshold`: If collateral falls more than `crThreshold` % below the min collateral requirement,
        // then it will be liquidated. For example: If the minimum collateralization ratio is 120% and the TRV is 100,
        // then the minimum collateral requirement is 120. However, if `crThreshold = 0.02`, then the minimum
        // collateral requirement is 120 * (1-0.02) = 117.6, or 2% below 120.
        value: 0.02,
        isValid: x => {
          return x < 1 && x >= 0;
        }
      },
      liquidationDeadline: {
        // `liquidationDeadline`: Aborts the liquidation if the transaction is mined this amount of time after the
        // EMP client's last update time. Denominated in seconds, so 300 = 5 minutes.
        value: 300,
        isValid: x => {
          return x >= 0;
        }
      },
      liquidationMinPrice: {
        // `liquidationMinPrice`: Aborts the liquidation if the amount of collateral in the position per token
        // outstanding is below this ratio.
        value: this.toWei("0"),
        isValid: x => {
          return this.toBN(x).gte(this.toBN("0"));
        }
        // TODO: We should specify as a percentage of the token price so that no valid
        // liquidation would ever lose money.
      },
      txnGasLimit: {
        // `txnGasLimit`: Gas limit to set for sending on-chain transactions.
        value: 9000000, // Can see recent averages here: https://etherscan.io/chart/gaslimit
        isValid: x => {
          return x >= 6000000 && x < 15000000;
        }
      },
      logOverrides: {
        // Specify an override object to change default logging behaviour. Defaults to no overrides. If specified, this
        // object is structured to contain key for the log to override and value for the logging level. EG:
        // { positionLiquidated:'warn' } would override the default `info` behaviour for liquidationEvents.
        value: {},
        isValid: overrides => {
          // Override must be one of the default logging levels: ['error','warn','info','http','verbose','debug','silly']
          return Object.values(overrides).every(param => Object.keys(this.logger.levels).includes(param));
        }
      },
      whaleDefenseFundWei: {
        // by default make this disabled
        value: undefined,
        isValid: x => {
          if (x === undefined) return true;
          return this.toBN(x).gte(this.toBN("0"));
        }
      },
      defenseActivationPercent: {
        value: undefined,
        isValid: x => {
          if (x === undefined) return true;
          return parseFloat(x) >= 0 && parseFloat(x) <= 100;
        }
      }
    };

    // Validate and set config settings to class state.
    const configWithDefaults = createObjectFromDefaultProps(config, defaultConfig);
    Object.assign(this, configWithDefaults);

    // generalize log emitter, use it to attach default data to all logs
    const log = (severity = "info", data = {}) => {
      // would rather just throw here and let index.js capture and log, but
      // its currently not set up to add in the additional context for the error
      // so it has to be done here.
      if (logger[severity] == null) {
        return logger.error({
          at: "Liquidator",
          ...data,
          error: "Trying to submit log with unknown severity: " + severity
        });
      }
      return logger[severity]({
        at: "Liquidator",
        // could add in additional context for any error thrown,
        // such as state of emp or bot configuration data
        minLiquidationPrice: this.liquidationMinPrice,
        ...data
      });
    };
    this.log = log;

    // this takes in config, and emits log events
    this.liquidationStrategy = LiquidationStrategy(
      {
        ...configWithDefaults,
        ...empProps
      },
      this.web3.utils,
      log
    );
  }

  // Update the empClient, gasEstimator and price feed. If a client has recently updated then it will do nothing.
  async update() {
    await Promise.all([this.empClient.update(), this.gasEstimator.update(), this.priceFeed.update()]);
  }
  // Queries underCollateralized positions and performs liquidations against any under collateralized positions.
  // If `maxTokensToLiquidateWei` is not passed in, then the bot will attempt to liquidate the full position.
  // If liquidatorOverridePrice is provided then the liquidator bot will override the price feed with this input price.
  async liquidatePositions(maxTokensToLiquidateWei, liquidatorOverridePrice) {
    this.logger.debug({
      at: "Liquidator",
      message: "Checking for liquidatable positions and preforming liquidations"
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
      .mul(this.toBN(this.empCRRatio))
      .div(this.toBN(this.toWei("1")));

    this.logger.debug({
      at: "Liquidator",
      message: "Checking for under collateralized positions",
      liquidatorOverridePrice: liquidatorOverridePrice ? liquidatorOverridePrice.toString() : null,
      inputPrice: price.toString(),
      scaledPrice: scaledPrice.toString(),
      empCRRatio: this.empCRRatio.toString(),
      maxCollateralPerToken: maxCollateralPerToken.toString(),
      crThreshold: this.crThreshold
    });

    // Get the latest undercollateralized positions from the client.
    const underCollateralizedPositions = this.empClient.getUnderCollateralizedPositions(scaledPrice);

    if (underCollateralizedPositions.length === 0) {
      this.logger.debug({
        at: "Liquidator",
        message: "No undercollateralized position"
      });
      return;
    }

    for (const position of underCollateralizedPositions) {
      this.logger.debug({
        at: "Liquidator",
        message: "Detected a liquidatable position",
        scaledPrice: scaledPrice.toString(),
        maxCollateralPerToken: maxCollateralPerToken.toString(),
        position: JSON.stringify(position)
      });

      // Note: query the time again during each iteration to ensure the deadline is set reasonably.
      const currentBlockTime = this.empClient.getLastUpdateTime();
      const syntheticTokenBalance = this.toBN(await this.syntheticToken.methods.balanceOf(this.account).call());

      // run strategy based on configs and current state
      // will return liquidation arguments or nothing
      // if it returns nothing it means this position cant be or shouldnt be liquidated
      const liquidationArgs = this.liquidationStrategy.processPosition({
        // position is assumed to be undercollateralized
        position,
        // need to know our current balance to know how much to save for defense fund
        syntheticTokenBalance,
        // this is required to create liquidation object
        maxCollateralPerToken,
        // maximum tokens we can liquidate in position
        maxTokensToLiquidateWei,
        // minimim position size, as well as minimum liquidation to extend withdraw
        empMinSponsorSize: this.empMinSponsorSize,
        currentBlockTime,
        // for logging
        inputPrice: scaledPrice.toString()
      });

      // we couldnt liquidate, this typically would only happen if our balance is 0
      // This gets logged as an event, see constructor
      if (!liquidationArgs) {
        // the bot cannot liquidate the full position size, but the full position size is at the minimum sponsor threshold. Therefore, the
        // bot can liquidate 0 tokens. The smart contracts should disallow this, but a/o June 2020 this behavior is allowed so we should block it
        // client-side.
        this.logger.error({
          at: "Liquidator",
          message: "Position size is equal to the minimum: not enough synthetic to initiate full liquidation✋",
          sponsor: position.sponsor,
          inputPrice: scaledPrice.toString(),
          position: position,
          minLiquidationPrice: this.liquidationMinPrice,
          maxLiquidationPrice: maxCollateralPerToken.toString(),
          tokensToLiquidate: "0",
          syntheticTokenBalance: syntheticTokenBalance.toString(),
          error: new Error("Refusing to liquidate 0 tokens")
        });
        continue;
      }

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
          maxTokensToLiquidateWei: maxTokensToLiquidateWei ? maxTokensToLiquidateWei.toString() : null
        });
      }

      // liquidation strategy will control how much to liquidate
      const liquidation = this.empContract.methods.createLiquidation(...liquidationArgs);

      // Send the transaction or report failure.
      let receipt;
      let txnConfig;
      try {
        // Configure tx config object
        const gasEstimation = await liquidation.estimateGas({ from: this.account });
        txnConfig = {
          from: this.account,
          gas: Math.min(Math.floor(gasEstimation * this.GAS_LIMIT_BUFFER), this.txnGasLimit),
          gasPrice: this.gasEstimator.getCurrentFastPrice()
        };

        // Make sure to keep trying with this nonce
        const nonce = await this.web3.eth.getTransactionCount(this.account);

        // Min Gas Price, with a max gasPrice of x4
        const minGasPrice = parseInt(this.gasEstimator.getCurrentFastPrice(), 10);
        const maxGasPrice = 2 * 3 * minGasPrice;

        // Doubles gasPrice every iteration
        const gasPriceScalingFunction = ynatm.DOUBLES;

        this.logger.debug({
          at: "Liquidator",
          message: "Liquidating position",
          position: position,
          inputPrice: scaledPrice.toString(),
          minLiquidationPrice: this.liquidationMinPrice,
          maxLiquidationPrice: maxCollateralPerToken.toString(),
          tokensToLiquidate: tokensToLiquidate.toString(),
          txnConfig
        });

        // Receipt without events
        receipt = await ynatm.send({
          sendTransactionFunction: gasPrice => liquidation.send({ ...txnConfig, nonce, gasPrice }),
          minGasPrice,
          maxGasPrice,
          gasPriceScalingFunction,
          delay: 60000 // Tries and doubles gasPrice every minute if tx hasn't gone through
        });
      } catch (error) {
        this.logger.error({
          at: "Liquidator",
          message: "Failed to liquidate position🚨",
          error
        });
        continue;
      }

      const logResult = {
        tx: receipt && receipt.transactionHash,
        sponsor: receipt.events.LiquidationCreated.returnValues.sponsor,
        liquidator: receipt.events.LiquidationCreated.returnValues.liquidator,
        liquidationId: receipt.events.LiquidationCreated.returnValues.liquidationId,
        tokensOutstanding: receipt.events.LiquidationCreated.returnValues.tokensOutstanding,
        lockedCollateral: receipt.events.LiquidationCreated.returnValues.lockedCollateral,
        liquidatedCollateral: receipt.events.LiquidationCreated.returnValues.liquidatedCollateral
      };

      // This log level can be overridden by specifying `positionLiquidated` in the `logOverrides`. Otherwise, use info.
      this.logger[this.logOverrides.positionLiquidated || "info"]({
        at: "Liquidator",
        message: "Position has been liquidated!🔫",
        position: position,
        inputPrice: scaledPrice.toString(),
        txnConfig,
        liquidationResult: logResult
      });
    }
  }

  // Queries ongoing liquidations and attempts to withdraw rewards from both expired and disputed liquidations.
  async withdrawRewards() {
    this.logger.debug({
      at: "Liquidator",
      message: "Checking for expired and disputed liquidations to withdraw rewards from"
    });

    // All of the liquidations that we could withdraw rewards from are drawn from the pool of
    // expired and disputed liquidations.
    const expiredLiquidations = this.empClient.getExpiredLiquidations();
    const disputedLiquidations = this.empClient.getDisputedLiquidations();
    const potentialWithdrawableLiquidations = expiredLiquidations
      .concat(disputedLiquidations)
      .filter(liquidation => liquidation.liquidator === this.account);

    if (potentialWithdrawableLiquidations.length === 0) {
      this.logger.debug({
        at: "Liquidator",
        message: "No withdrawable liquidations"
      });
      return;
    }

    for (const liquidation of potentialWithdrawableLiquidations) {
      this.logger.debug({
        at: "Liquidator",
        message: "Detected a pending or expired liquidation",
        liquidation: JSON.stringify(liquidation)
      });

      // Construct transaction.
      const withdraw = this.empContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor);

      // Confirm that liquidation has eligible rewards to be withdrawn.
      let withdrawAmount, gasEstimation;
      try {
        [withdrawAmount, gasEstimation] = await Promise.all([
          withdraw.call({ from: this.account }),
          withdraw.estimateGas({ from: this.account })
        ]);
        // Mainnet view/pure functions sometimes don't revert, even if a require is not met. The revertWrapper ensures this
        // caught correctly. see https://forum.openzeppelin.com/t/require-in-view-pure-functions-dont-revert-on-public-networks/1211
        if (revertWrapper(withdrawAmount) === null) {
          throw new Error("Simulated reward withdrawal failed");
        }
      } catch (error) {
        this.logger.debug({
          at: "Liquidator",
          message: "No rewards to withdraw",
          liquidation: liquidation,
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
        at: "Liquidator",
        message: "Withdrawing liquidation",
        liquidation: liquidation,
        amount: withdrawAmount.rawValue.toString(),
        txnConfig
      });

      // Before submitting transaction, store liquidation timestamp before it is potentially deleted if this is the final reward to be withdrawn.
      // We can be confident that `liquidationTime` property is available and accurate because the liquidation has not been deleted yet if we `withdrawLiquidation()`
      // is callable.
      let requestTimestamp = liquidation.liquidationTime;

      // Send the transaction or report failure.
      let receipt;
      try {
        const nonce = await this.web3.eth.getTransactionCount(this.account);

        // Min Gas Price, with a max gasPrice of x6 (3 re-tries)
        const minGasPrice = parseInt(this.gasEstimator.getCurrentFastPrice(), 10);
        const maxGasPrice = 2 * 3 * minGasPrice;

        // Doubles gasPrice every iteration
        const gasPriceScalingFunction = ynatm.DOUBLES;

        // Receipt without events
        receipt = await ynatm.send({
          sendTransactionFunction: gasPrice => withdraw.send({ ...txnConfig, nonce, gasPrice }),
          minGasPrice,
          maxGasPrice,
          gasPriceScalingFunction,
          delay: 60000 // Tries and doubles gasPrice every minute if tx hasn't gone through
        });
      } catch (error) {
        this.logger.error({
          at: "Liquidator",
          message: "Failed to withdraw liquidation rewards🚨",
          error
        });
        continue;
      }

      // Get resolved price request for dispute. This will fail if there is no price for the liquidation timestamp, which is possible if the
      // liquidation expired without dispute.
      let resolvedPrice;
      if (requestTimestamp) {
        try {
          resolvedPrice = revertWrapper(
            await this.votingContract.methods.getPrice(this.empIdentifier, requestTimestamp).call({
              from: this.empContract.options.address
            })
          );
        } catch (error) {
          // Ignore any errors as this indicates that there is nothing to do yet.
        }
      }

      const logResult = {
        tx: receipt.transactionHash,
        caller: receipt.events.LiquidationWithdrawn.returnValues.caller,
        withdrawalAmount: receipt.events.LiquidationWithdrawn.returnValues.withdrawalAmount,
        liquidationStatus:
          PostWithdrawLiquidationRewardsStatusTranslations[
            receipt.events.LiquidationWithdrawn.returnValues.liquidationStatus
          ]
      };

      // If there is no price available for the withdrawable liquidation, likely that liquidation expired without dispute.
      if (resolvedPrice) {
        logResult.resolvedPrice = resolvedPrice.toString();
      }

      this.logger.info({
        at: "Liquidator",
        message: "Liquidation withdrawn🤑",
        liquidation: liquidation,
        amount: withdrawAmount.rawValue.toString(),
        txnConfig,
        liquidationResult: logResult
      });
    }
  }
}

module.exports = {
  Liquidator
};
