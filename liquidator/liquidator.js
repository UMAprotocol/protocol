// When running this script it assumed that the account has enough tokens and allowance from the unlocked Truffle
// wallet to run the liquidations. Future versions will deal with generating additional synthetic tokens from EMPs as the bot needs.

class Liquidator {
  /**
   * @notice Constructs new Liquidator bot.
   * @param {*Object} logger Module used to send logs.
   * @param {*Object} expiringMultiPartyClient Module used to query EMP information on-chain.
   * @param {*Object} gasEstimator Module used to estimate optimal gas price with which to send txns.
   * @param {*String} account Ethereum account from which to send txns.
   * @param {?Object} config Optional. Contains fields with which constructor will attempt to override defaults.
   */
  constructor(logger, expiringMultiPartyClient, gasEstimator, account, config) {
    this.logger = logger;
    this.account = account;

    // Expiring multiparty contract to read contract state
    this.empClient = expiringMultiPartyClient;
    this.web3 = this.empClient.web3;

    // Gas Estimator to calculate the current Fast gas rate.
    this.gasEstimator = gasEstimator;

    // Instance of the expiring multiparty to perform on-chain liquidations.
    this.empContract = this.empClient.emp;

    /**
     * @notice Default config settings. Liquidator deployer can override these settings by passing in new
     * values via the `config` input object.
     * @dev The `isValid` property is a function that should be called before resetting any config settings.
     * `isValid` must return a Boolean.
     */
    const { toBN, toWei } = this.web3.utils;
    const defaultConfig = {
      crThreshold: {
        // `crThreshold`: Expressed as a percentage. If a position's CR is below the
        // minimum CR allowed times `crThreshold`, then the bot will liquidate the position.
        // This acts as a defensive buffer against sharp price movements delays in transactions getting mined.
        value: toWei("0.98"),
        isValid: x => {
          return toBN(x).gt("0");
        }
      }
    };

    // Set and validate config settings
    Object.keys(defaultConfig).forEach(field => {
      this[field] = config && config[field] ? config[field] : defaultConfig[field].value;
      if (!defaultConfig[field].isValid(this[field])) {
        this.logger.error({
          at: "Liquidator",
          message: "Attempting to set configuration field with invalid value",
          field: field,
          value: this[field]
        });
        throw new Error("Attempting to set configuration field with invalid value");
      }
    });
  }

  // Update the client and gasEstimator clients.
  // If a client has recently updated then it will do nothing.
  update = async () => {
    await this.empClient.update();
    await this.gasEstimator.update();
  };

  // Queries underCollateralized positions and performs liquidations against any under collateralized positions.
  queryAndLiquidate = async priceFunction => {
    const { toBN, fromWei, toWei } = this.web3.utils;

    const contractTime = this.empClient.getLastUpdateTime();
    let priceFeed = priceFunction(contractTime);

    // The `priceFeed` is a Number that is used to determine if a position is liquidatable. The higher the
    // `priceFeed` value, the more collateral that the position is required to have to be correctly collateralized.
    // Therefore, we add a buffer by reducing `priceFeed` to (`crThreshold` * `priceFeed`).
    priceFeed = fromWei(toBN(priceFeed).mul(toBN(this.crThreshold)));

    this.logger.debug({
      at: "Liquidator",
      message: "Raising liquidation price threshold",
      priceFeed: priceFeed,
      priceThreshold: this.priceThreshold
    });

    this.logger.debug({
      at: "Liquidator",
      message: "Checking for under collateralized positions",
      inputPrice: priceFeed
    });

    await this.update();

    // Get the latest undercollateralized positions from the client.
    const underCollateralizedPositions = this.empClient.getUnderCollateralizedPositions(priceFeed);

    if (underCollateralizedPositions.length === 0) {
      this.logger.debug({
        at: "Liquidator",
        message: "No undercollateralized position"
      });
      return;
    }

    for (const position of underCollateralizedPositions) {
      // Note: query the time again during each iteration to ensure the deadline is set reasonably.
      const currentBlockTime = this.empClient.getLastUpdateTime();
      const fiveMinutes = 300;
      // Create the transaction.
      const liquidation = this.empContract.methods.createLiquidation(
        position.sponsor,
        { rawValue: "0" },
        { rawValue: toWei(priceFeed) },
        { rawValue: position.numTokens },
        parseInt(currentBlockTime) + fiveMinutes
      );

      // Simple version of inventory management: simulate the transaction and assume that if it fails, the caller didn't have enough collateral.
      try {
        await liquidation.call({ from: this.account });
      } catch (error) {
        this.logger.error({
          at: "Liquidator",
          message:
            "Cannot liquidate position: not enough synthetic (or large enough approval) to initiate liquidation✋",
          sponsor: position.sponsor,
          position: position,
          error: error
        });
        continue;
      }

      const txnConfig = {
        from: this.account,
        gas: 1500000,
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      };
      this.logger.debug({
        at: "Liquidator",
        message: "Liquidating position",
        position: position,
        inputPrice: toWei(priceFeed),
        txnConfig
      });

      // Send the transaction or report failure.
      let receipt;
      try {
        receipt = await liquidation.send(txnConfig);
      } catch (error) {
        this.logger.error({
          at: "Liquidator",
          message: "Failed to liquidate position🚨",
          error: error
        });
        continue;
      }

      const logResult = {
        tx: receipt.transactionHash,
        sponsor: receipt.events.LiquidationCreated.returnValues.sponsor,
        liquidator: receipt.events.LiquidationCreated.returnValues.liquidator,
        liquidationId: receipt.events.LiquidationCreated.returnValues.liquidationId,
        tokensOutstanding: receipt.events.LiquidationCreated.returnValues.tokensOutstanding,
        lockedCollateral: receipt.events.LiquidationCreated.returnValues.lockedCollateral,
        liquidatedCollateral: receipt.events.LiquidationCreated.returnValues.liquidatedCollateral
      };
      this.logger.info({
        at: "Liquidator",
        message: "Position has been liquidated!🔫",
        position: position,
        inputPrice: toWei(priceFeed),
        txnConfig,
        liquidationResult: logResult
      });
    }

    // Update the EMP Client since we created new liquidations.
    await this.empClient.update();
  };

  // Queries ongoing liquidations and attempts to withdraw rewards from both expired and disputed liquidations.
  queryAndWithdrawRewards = async () => {
    const { fromWei } = this.web3.utils;

    this.logger.debug({
      at: "Liquidator",
      message: "Checking for expired and disputed liquidations to withdraw rewards from"
    });

    await this.update();

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
      // Construct transaction.
      const withdraw = this.empContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor);

      // Confirm that liquidation has eligible rewards to be withdrawn.
      let withdrawAmount;
      try {
        withdrawAmount = await withdraw.call({ from: this.account });
      } catch (error) {
        this.logger.debug({
          at: "Liquidator",
          message: "No rewards to withdraw.",
          liquidation: liquidation,
          error: error
        });
        continue;
      }

      const txnConfig = {
        from: this.account,
        gas: 1500000,
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      };
      this.logger.debug({
        at: "Liquidator",
        message: "Withdrawing liquidation",
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
          at: "Liquidator",
          message: "Failed to withdraw liquidation rewards",
          error: error
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
        at: "Liquidator",
        message: "Liquidation withdrawn🤑",
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
  Liquidator
};
