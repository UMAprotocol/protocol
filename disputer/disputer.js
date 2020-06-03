// When running this script it assumed that the account has enough tokens and allowance from the unlocked truffle
// wallet to run the liquidations. Future versions will deal with generating additional synthetic tokens from EMPs as the bot needs.

const { createObjectFromDefaultProps } = require("../common/ObjectUtils");

class Disputer {
  /**
   * @notice Constructs new Disputer bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} expiringMultiPartyClient Module used to query EMP information on-chain.
   * @param {Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {Object} priceFeed Module used to get the current or historical token price.
   * @param {String} account Ethereum account from which to send txns.
   * @param {Object} [config] Contains fields with which constructor will attempt to override defaults.
   */
  constructor(logger, expiringMultiPartyClient, gasEstimator, priceFeed, account, config) {
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
  // If a client has recently updated then it will do nothing.
  update = async () => {
    await this.empClient.update();
    await this.gasEstimator.update();
    await this.priceFeed.update();
  };

  // Queries disputable liquidations and disputes any that were incorrectly liquidated.
  queryAndDispute = async () => {
    this.logger.debug({
      at: "Disputer",
      message: "Checking for any disputable liquidations"
    });

    await this.update();

    // Get the latest disputable liquidations from the client.
    const undisputedLiquidations = this.empClient.getUndisputedLiquidations();
    const disputeableLiquidations = undisputedLiquidations.filter(liquidation => {
      const price = this.priceFeed.getHistoricalPrice(parseInt(liquidation.liquidationTime.toString()));
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
      try {
        await dispute.call({ from: this.account, gasPrice: this.gasEstimator.getCurrentFastPrice() });
      } catch (error) {
        this.logger.error({
          at: "Disputer",
          message: "Cannot dispute liquidation: not enough collateral (or large enough approval) to initiate dispute✋",
          sponsor: disputeableLiquidation.sponsor,
          liquidation: disputeableLiquidation,
          error: new Error(error)
        });
        continue;
      }

      const txnConfig = {
        from: this.account,
        gas: this.txnGasLimit,
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
          error: new Error(error)
        });
        continue;
      }

      const logResult = {
        tx: receipt.transactionHash,
        sponsor: receipt.events.LiquidationDisputed.returnValues.sponsor,
        liquidator: receipt.events.LiquidationDisputed.returnValues.liquidator,
        id: receipt.events.LiquidationDisputed.returnValues.disputeId,
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

    // Update the EMP Client since we disputed liquidations.
    await this.empClient.update();
  };

  // Queries ongoing disputes and attempts to withdraw any pending rewards from them.
  queryAndWithdrawRewards = async () => {
    const { fromWei } = this.web3.utils;

    this.logger.debug({
      at: "Disputer",
      message: "Checking for disputed liquidations that may have resolved"
    });

    await this.update();

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
      // Construct transaction.
      const withdraw = this.empContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor);

      // Confirm that dispute has eligible rewards to be withdrawn.
      let withdrawAmount;
      try {
        withdrawAmount = await withdraw.call({ from: this.account });
      } catch (error) {
        this.logger.debug({
          at: "Disputer",
          message: "No rewards to withdraw",
          liquidation: liquidation,
          error: new Error(error)
        });
        continue;
      }

      const txnConfig = {
        from: this.account,
        gas: this.txnGasLimit,
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      };
      this.logger.debug({
        at: "Liquidator",
        message: "Withdrawing dispute",
        liquidation: liquidation,
        amount: fromWei(withdrawAmount.rawValue),
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
          error: new Error(error)
        });
        continue;
      }

      const logResult = {
        tx: receipt.transactionHash,
        caller: receipt.events.LiquidationWithdrawn.returnValues.caller,
        withdrawalAmount: receipt.events.LiquidationWithdrawn.returnValues.withdrawalAmount,
        liquidationStatus: receipt.events.LiquidationWithdrawn.returnValues.liquidationStatus
      };
      this.logger.info({
        at: "Disputer",
        message: "Dispute withdrawn🤑",
        liquidation: liquidation,
        amount: fromWei(withdrawAmount.rawValue),
        txnConfig,
        liquidationResult: logResult
      });
    }

    // Update the EMP Client since we withdrew rewards.
    await this.empClient.update();
  };
}

module.exports = {
  Disputer
};
