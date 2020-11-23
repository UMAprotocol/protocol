const {
  PostWithdrawLiquidationRewardsStatusTranslations,
  revertWrapper,
  createObjectFromDefaultProps
} = require("@uma/common");

class Disputer {
  /**
   * @notice Constructs new Disputer bot.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} expiringMultiPartyClient Module used to query EMP information on-chain.
   * @param {Object} votingContract DVM to query price requests.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {Object} priceFeed Module used to get the current or historical token price.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} empProps Contains EMP contract state data. Expected:
   *      { priceIdentifier: hex("ETH/BTC") }
   * @param {Object} [config] Contains fields with which constructor will attempt to override defaults.
   */
  constructor({
    logger,
    expiringMultiPartyClient,
    votingContract,
    gasEstimator,
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

    // Gas Estimator to calculate the current Fast gas rate
    this.gasEstimator = gasEstimator;

    // Price feed to compute the token price.
    this.priceFeed = priceFeed;

    // Instance of the expiring multiparty to perform on-chain disputes
    this.empContract = this.empClient.emp;
    this.votingContract = votingContract;

    this.empIdentifier = empProps.priceIdentifier;

    // Helper functions from web3.
    this.fromWei = this.web3.utils.fromWei;
    this.toBN = this.web3.utils.toBN;
    this.utf8ToHex = this.web3.utils.utf8ToHex;

    // Multiplier applied to Truffle's estimated gas limit for a transaction to send.
    this.GAS_LIMIT_BUFFER = 1.25;

    // Default config settings. Disputer deployer can override these settings by passing in new
    // values via the `config` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean.
    const defaultConfig = {
      disputeDelay: {
        // `disputeDelay`: Amount of time to wait after the request timestamp of the liquidation to be disputed.
        // This makes the reading of the historical price more reliable. Denominated in seconds.
        value: 60,
        isValid: x => {
          return x >= 0;
        }
      },
      txnGasLimit: {
        // `txnGasLimit`: Gas limit to set for sending on-chain transactions.
        value: 9000000, // Can see recent averages here: https://etherscan.io/chart/gaslimit
        isValid: x => {
          return x >= 6000000 && x < 15000000;
        }
      }
    };

    // Validate and set config settings to class state.
    Object.assign(this, createObjectFromDefaultProps(config, defaultConfig));
  }

  // Update the client and gasEstimator clients.
  async update() {
    await Promise.all([this.empClient.update(), this.gasEstimator.update(), this.priceFeed.update()]);
  }

  // Queries disputable liquidations and disputes any that were incorrectly liquidated. If `disputerOverridePrice` is
  // provided then the disputer will ignore the price feed and use the override price instead for all undisputed liquidations.
  async dispute(disputerOverridePrice) {
    this.logger.debug({
      at: "Disputer",
      message: "Checking for any disputable liquidations"
    });

    // Get the latest disputable liquidations from the client.
    const undisputedLiquidations = this.empClient.getUndisputedLiquidations();
    const disputeableLiquidations = undisputedLiquidations.filter(liquidation => {
      // If an override is provided, use that price. Else, get the historic price at the liquidation time.
      const price = disputerOverridePrice
        ? this.toBN(disputerOverridePrice)
        : this.priceFeed.getHistoricalPrice(parseInt(liquidation.liquidationTime.toString()));
      if (!price) {
        this.logger.warn({
          at: "Disputer",
          message: "Cannot dispute: price feed returned invalid value"
        });
        return false;
      } else {
        if (
          this.empClient.isDisputable(liquidation, price) &&
          this.empClient.getLastUpdateTime() >= Number(liquidation.liquidationTime) + this.disputeDelay
        ) {
          this.logger.debug({
            at: "Disputer",
            message: "Detected a disputable liquidation",
            price: price.toString(),
            liquidation: JSON.stringify(liquidation)
          });
          return true;
        } else {
          return false;
        }
      }
    });

    if (disputeableLiquidations.length === 0) {
      this.logger.debug({
        at: "Disputer",
        message: "No disputable liquidations"
      });
      return;
    }

    for (const disputeableLiquidation of disputeableLiquidations) {
      // Create the transaction.
      const dispute = this.empContract.methods.dispute(disputeableLiquidation.id, disputeableLiquidation.sponsor);

      // Simple version of inventory management: simulate the transaction and assume that if it fails, the caller didn't have enough collateral.
      let totalPaid, gasEstimation;
      try {
        [totalPaid, gasEstimation] = await Promise.all([
          dispute.call({ from: this.account }),
          dispute.estimateGas({ from: this.account })
        ]);
      } catch (error) {
        this.logger.error({
          at: "Disputer",
          message: "Cannot dispute liquidation: not enough collateral (or large enough approval) to initiate dispute✋",
          disputer: this.account,
          sponsor: disputeableLiquidation.sponsor,
          liquidation: disputeableLiquidation,
          totalPaid,
          error
        });
        continue;
      }

      const txnConfig = {
        from: this.account,
        gas: Math.min(Math.floor(gasEstimation * this.GAS_LIMIT_BUFFER), this.txnGasLimit),
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      };

      const disputeTime = parseInt(disputeableLiquidation.liquidationTime.toString());
      const inputPrice = this.priceFeed.getHistoricalPrice(disputeTime).toString();

      this.logger.debug({
        at: "Disputer",
        message: "Disputing liquidation",
        liquidation: disputeableLiquidation,
        inputPrice,
        txnConfig
      });

      // Send the transaction or report failure.
      let receipt;
      try {
        receipt = await dispute.send(txnConfig);
      } catch (error) {
        this.logger.error({
          at: "Disputer",
          message: "Failed to dispute liquidation🚨",
          error
        });
        continue;
      }

      const logResult = {
        tx: receipt.transactionHash,
        sponsor: receipt.events.LiquidationDisputed.returnValues.sponsor,
        liquidator: receipt.events.LiquidationDisputed.returnValues.liquidator,
        id: receipt.events.LiquidationDisputed.returnValues.liquidationId,
        disputeBondPaid: receipt.events.LiquidationDisputed.returnValues.disputeBondAmount
      };
      this.logger.info({
        at: "Disputer",
        message: "Position has been disputed!👮‍♂️",
        liquidation: disputeableLiquidation,
        inputPrice,
        txnConfig,
        disputeResult: logResult
      });
    }
  }

  // Queries ongoing disputes and attempts to withdraw any pending rewards from them.
  async withdrawRewards() {
    this.logger.debug({
      at: "Disputer",
      message: "Checking for disputed liquidations that may have resolved"
    });

    // Can only derive rewards from disputed liquidations that this account disputed.
    const disputedLiquidations = this.empClient
      .getDisputedLiquidations()
      .filter(liquidation => liquidation.disputer === this.account);

    if (disputedLiquidations.length === 0) {
      this.logger.debug({
        at: "Disputer",
        message: "No withdrawable disputes"
      });
      return;
    }

    for (const liquidation of disputedLiquidations) {
      this.logger.debug({
        at: "Disputer",
        message: "Detected a disputed liquidation",
        liquidation: JSON.stringify(liquidation)
      });

      // Construct transaction.
      const withdraw = this.empContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor);

      // Confirm that dispute has eligible rewards to be withdrawn.
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
          at: "Disputer",
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
        message: "Withdrawing dispute",
        liquidation: liquidation,
        amount: withdrawAmount.rawValue.toString(),
        txnConfig
      });

      // Before submitting transaction, store liquidation timestamp before it is potentially deleted if this is the final reward to be withdrawn.
      // We can be confident that `liquidationTime` property is available and accurate because the liquidation has not been deleted yet if we `withdrawLiquidation()`
      // is callable.
      const requestTimestamp = liquidation.liquidationTime;

      // Send the transaction or report failure.
      let receipt;
      try {
        receipt = await withdraw.send(txnConfig);
      } catch (error) {
        this.logger.error({
          at: "Disputer",
          message: "Failed to withdraw dispute rewards🚨",
          error
        });
        continue;
      }

      // Get resolved price request for dispute. `getPrice()` should not fail since the dispute price request must have settled in order for `withdrawLiquidation()`
      // to be callable.
      let resolvedPrice = await this.votingContract.methods.getPrice(this.empIdentifier, requestTimestamp).call({
        from: this.empContract.options.address
      });

      const logResult = {
        tx: receipt.transactionHash,
        caller: receipt.events.LiquidationWithdrawn.returnValues.caller,
        withdrawalAmount: receipt.events.LiquidationWithdrawn.returnValues.withdrawalAmount,
        liquidationStatus:
          PostWithdrawLiquidationRewardsStatusTranslations[
            receipt.events.LiquidationWithdrawn.returnValues.liquidationStatus
          ],
        resolvedPrice: resolvedPrice.toString()
      };

      this.logger.info({
        at: "Disputer",
        message: "Dispute withdrawn🤑",
        liquidation: liquidation,
        amount: withdrawAmount.rawValue.toString(),
        txnConfig,
        liquidationResult: logResult
      });
    }
  }
}

module.exports = {
  Disputer
};
