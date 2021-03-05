const {
  PostWithdrawLiquidationRewardsStatusTranslations,
  revertWrapper,
  createObjectFromDefaultProps
} = require("@uma/common");

class Disputer {
  /**
   * @notice Constructs new Disputer bot.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} financialContractClient Module used to query Financial Contract information on-chain.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {Object} priceFeed Module used to get the current or historical token price.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} financialContractProps Contains Financial Contract contract state data. Expected:
   *      { priceIdentifier: hex("ETH/BTC") }
   * @param {Object} [disputerConfig] Contains fields with which constructor will attempt to override defaults.
   */
  constructor({
    logger,
    financialContractClient,
    gasEstimator,
    priceFeed,
    account,
    financialContractProps,
    disputerConfig
  }) {
    this.logger = logger;
    this.account = account;

    // Expiring multiparty contract to read contract state
    this.financialContractClient = financialContractClient;
    this.web3 = this.financialContractClient.web3;

    // Gas Estimator to calculate the current Fast gas rate
    this.gasEstimator = gasEstimator;

    // Price feed to compute the token price.
    this.priceFeed = priceFeed;

    // Instance of the expiring multiparty to perform on-chain disputes
    this.financialContract = this.financialContractClient.financialContract;

    this.financialContractIdentifier = financialContractProps.priceIdentifier;

    // Helper functions from web3.
    this.fromWei = this.web3.utils.fromWei;
    this.toBN = this.web3.utils.toBN;
    this.utf8ToHex = this.web3.utils.utf8ToHex;

    // Multiplier applied to Truffle's estimated gas limit for a transaction to send.
    this.GAS_LIMIT_BUFFER = 1.25;

    // Default config settings. Disputer deployer can override these settings by passing in new
    // values via the `disputerConfig` input object. The `isValid` property is a function that should be called
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
      },
      contractType: {
        value: undefined,
        isValid: x => {
          return x === "ExpiringMultiParty" || x === "Perpetual";
        }
      },
      contractVersion: {
        value: undefined,
        isValid: x => {
          return x === "1.2.0" || x === "1.2.1" || x === "1.2.2" || x === "latest";
        }
      }
    };

    // Validate and set config settings to class state.
    Object.assign(this, createObjectFromDefaultProps(disputerConfig, defaultConfig));

    // These EMP versions have different "LiquidationWithdrawn" event parameters that we need to handle.
    this.isLegacyEmpVersion = Boolean(
      this.contractVersion === "1.2.0" || this.contractVersion === "1.2.1" || this.contractVersion === "1.2.2"
    );
  }

  // Update the client and gasEstimator clients.
  async update() {
    await Promise.all([this.financialContractClient.update(), this.gasEstimator.update(), this.priceFeed.update()]);
  }

  // Queries disputable liquidations and disputes any that were incorrectly liquidated. If `disputerOverridePrice` is
  // provided then the disputer will ignore the price feed and use the override price instead for all undisputed liquidations.
  async dispute(disputerOverridePrice) {
    this.logger.debug({
      at: "Disputer",
      message: "Checking for any disputable liquidations"
    });

    // Get the latest disputable liquidations from the client.
    const undisputedLiquidations = this.financialContractClient.getUndisputedLiquidations();
    const disputableLiquidationsWithPrices = (
      await Promise.all(
        undisputedLiquidations.map(async liquidation => {
          // If liquidation time is before the price feed's lookback window, then we can skip this liquidation
          // because we will not be able to get a historical price. If a dispute override price is provided then
          // we can ignore this check.
          const liquidationTime = parseInt(liquidation.liquidationTime.toString());
          const historicalLookbackWindow =
            Number(this.priceFeed.getLastUpdateTime()) - Number(this.priceFeed.getLookback());
          if (!disputerOverridePrice && liquidationTime < historicalLookbackWindow) {
            this.logger.debug({
              at: "Disputer",
              message: "Cannot dispute: liquidation time before earliest price feed historical timestamp",
              liquidationTime,
              historicalLookbackWindow
            });
            return null;
          }

          // If an override is provided, use that price. Else, get the historic price at the liquidation time.
          let price;
          if (disputerOverridePrice) {
            price = this.toBN(disputerOverridePrice);
          } else {
            try {
              price = await this.priceFeed.getHistoricalPrice(liquidationTime);
            } catch (error) {
              this.logger.error({
                at: "Disputer",
                message: "Cannot dispute: price feed returned invalid value",
                error
              });
            }
          }
          // Price is available, use it to determine if the liquidation is disputable
          if (
            price &&
            this.financialContractClient.isDisputable(liquidation, price) &&
            this.financialContractClient.getLastUpdateTime() >= Number(liquidationTime) + this.disputeDelay
          ) {
            this.logger.debug({
              at: "Disputer",
              message: "Detected a disputable liquidation",
              price: price.toString(),
              liquidation: JSON.stringify(liquidation)
            });

            return { ...liquidation, price: price.toString() };
          }

          return null;
        })
      )
    ).filter(liquidation => liquidation !== null);

    if (disputableLiquidationsWithPrices.length === 0) {
      this.logger.debug({
        at: "Disputer",
        message: "No disputable liquidations"
      });
      return;
    }

    for (const disputeableLiquidation of disputableLiquidationsWithPrices) {
      // Create the transaction.
      const dispute = this.financialContract.methods.dispute(disputeableLiquidation.id, disputeableLiquidation.sponsor);

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

      this.logger.debug({
        at: "Disputer",
        message: "Disputing liquidation",
        liquidation: disputeableLiquidation,
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
    const disputedLiquidations = this.financialContractClient
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
      const withdraw = this.financialContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor);

      // Confirm that dispute has eligible rewards to be withdrawn.
      let withdrawalCallResponse, paidToDisputer, gasEstimation;
      try {
        [withdrawalCallResponse, gasEstimation] = await Promise.all([
          withdraw.call({ from: this.account }),
          withdraw.estimateGas({ from: this.account })
        ]);
        // Mainnet view/pure functions sometimes don't revert, even if a require is not met. The revertWrapper ensures this
        // caught correctly. see https://forum.openzeppelin.com/t/require-in-view-pure-functions-dont-revert-on-public-networks/1211

        // In contract version 1.2.2 and below this function returns one value: the amount withdrawn by the function caller.
        // In later versions it returns an object containing all payouts.
        paidToDisputer = this.isLegacyEmpVersion
          ? withdrawalCallResponse.rawValue.toString()
          : withdrawalCallResponse.paidToDisputer.rawValue.toString();

        // If the call would revert OR the disputer would get nothing for withdrawing then throw and continue.
        if (revertWrapper(withdrawalCallResponse) === null || paidToDisputer === "0") {
          throw new Error("Simulated reward withdrawal failed");
        }
      } catch (error) {
        this.logger.debug({
          at: "Disputer",
          message: "No rewards to withdraw",
          liquidation: liquidation
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
        paidToDisputer,
        txnConfig
      });

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

      let logResult = {
        tx: receipt.transactionHash,
        caller: receipt.events.LiquidationWithdrawn.returnValues.caller,
        settlementPrice: receipt.events.LiquidationWithdrawn.returnValues.settlementPrice,
        liquidationStatus:
          PostWithdrawLiquidationRewardsStatusTranslations[
            receipt.events.LiquidationWithdrawn.returnValues.liquidationStatus
          ]
      };

      // In contract version 1.2.2 and below this event returns one value, `withdrawalAmount`: the amount withdrawn by the function caller.
      // In later versions it returns an object containing all payouts.
      if (this.isLegacyEmpVersion) {
        logResult.withdrawalAmount = receipt.events.LiquidationWithdrawn.returnValues.withdrawalAmount;
      } else {
        logResult.paidToLiquidator = receipt.events.LiquidationWithdrawn.returnValues.paidToLiquidator;
        logResult.paidToDisputer = receipt.events.LiquidationWithdrawn.returnValues.paidToDisputer;
        logResult.paidToSponsor = receipt.events.LiquidationWithdrawn.returnValues.paidToSponsor;
      }

      this.logger.info({
        at: "Disputer",
        message: "Dispute withdrawn🤑",
        liquidation: liquidation,
        liquidationResult: logResult
      });
    }
  }
}

module.exports = {
  Disputer
};
