// When running this script it assumed that the account has enough tokens and allowance from the unlocked truffle
// wallet to run the liquidations. Future versions will deal with generating additional synthetic tokens from EMPs as the bot needs.

const { Logger } = require("../financial-templates-lib/logger/Logger");

class Liquidator {
  constructor(expiringMultiPartyClient, gasEstimator, account) {
    this.account = account;

    // Expiring multiparty contract to read contract state
    this.empClient = expiringMultiPartyClient;
    this.web3 = this.empClient.web3;

    // Gas Estimator to calculate the current Fast gas rate
    this.gasEstimator = gasEstimator;

    // Instance of the expiring multiparty to perform on-chain liquidations
    this.empContract = this.empClient.emp;
  }

  // Queries underCollateralized positions and performs liquidations against any under collateralized positions.
  queryAndLiquidate = async priceFeed => {
    Logger.debug({
      at: "Liquidator",
      message: "Checking for under collateralized positions",
      inputPrice: priceFeed
    });

    // Update the client to get the latest position information.
    await this.empClient._update();

    // Update the gasEstimator to get the latest gas price data.
    // If the client has a data point in the last 60 seconds returns immediately.
    await this.gasEstimator._update();

    // Get the latest undercollateralized positions from the client.
    const underCollateralizedPositions = this.empClient.getUnderCollateralizedPositions(priceFeed);

    if (underCollateralizedPositions.length === 0) {
      Logger.debug({
        at: "Liquidator",
        message: "No undercollateralized position"
      });
      return;
    }

    for (const position of underCollateralizedPositions) {
      // Create the transaction.
      const liquidation = this.empContract.methods.createLiquidation(
        position.sponsor,
        { rawValue: this.web3.utils.toWei(priceFeed) },
        { rawValue: position.numTokens }
      );

      // Simple version of inventory management: simulate the transaction and assume that if it fails, the caller didn't have enough collateral.
      try {
        await liquidation.call({ from: this.account });
      } catch (error) {
        Logger.error({
          at: "Liquidator",
          message:
            "Cannot liquidate position: not enough synthetic (or large enough approval) to initiate liquidation.",
          sponsor: position.sponsor,
          position: position
        });
        Logger.debug({
          at: "Liquidator",
          message: `Liquidate call error message: ${error.message}`,
          error
        });
        continue;
      }

      Logger.info({
        at: "Liquidator",
        message: "Liquidating position🔥",
        sponsor: position.sponsor,
        position: position,
        inputPrice: this.web3.utils.toWei(priceFeed),
        from: this.account,
        gas: 1500000,
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      });

      // Send the transaction or report failure.
      try {
        const receipt = await liquidation.send({
          from: this.account,
          gas: 1500000,
          gasPrice: this.gasEstimator.getCurrentFastPrice()
        });
        const logResult = {
          tx: receipt.transactionHash,
          sponsor: receipt.events.LiquidationCreated.returnValues.sponsor,
          liquidator: receipt.events.LiquidationCreated.returnValues.liquidator,
          liquidationId: receipt.events.LiquidationCreated.returnValues.liquidationId,
          tokensOutstanding: receipt.events.LiquidationCreated.returnValues.tokensOutstanding,
          lockedCollateral: receipt.events.LiquidationCreated.returnValues.lockedCollateral,
          liquidatedCollateral: receipt.events.LiquidationCreated.returnValues.liquidatedCollateral
        };
        Logger.info({
          at: "Liquidator",
          message: "Liquidation tx result 📄",
          liquidationResult: logResult
        });
      } catch (error) {
        Logger.error({
          at: "Liquidator",
          message: `Failed to liquidate position: ${error.message}`,
          error
        });
      }
    }
  };

  // Queries ongoing liquidations and attempts to withdraw rewards from both expired and disputed liquidations.
  queryAndWithdrawRewards = async () => {
    Logger.debug({
      at: "Liquidator",
      message: "Checking for expired and disputed liquidations to withdraw rewards from"
    });

    // Update the client to get the latest information.
    await this.empClient._update();

    // Update the gasEstimator to get the latest gas price data.
    // If the client has a data point in the last 60 seconds returns immediately.
    await this.gasEstimator._update();

    // All of the liquidations that we could withdraw rewards from are drawn from the pool of
    // expired and disputed liquidations.
    const expiredLiquidations = this.empClient.getExpiredLiquidations();
    const disputedLiquidations = this.empClient.getDisputedLiquidations();
    const potentialWithdrawableLiquidations = expiredLiquidations
      .concat(disputedLiquidations)
      .filter(liquidation => liquidation.liquidator === this.account);

    if (potentialWithdrawableLiquidations.length === 0) {
      Logger.debug({
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
        Logger.debug({
          at: "Liquidator",
          message: "No rewards to withdraw.",
          address: liquidation.sponsor,
          id: liquidation.id
        });
        Logger.debug({
          at: "Liquidator",
          message: `Withdraw liquidation error message: ${error.message}`,
          error
        });
        continue;
      }

      Logger.info({
        at: "Liquidator",
        message: "Withdrawing liquidation🤑",
        address: liquidation.sponsor,
        id: liquidation.id,
        amount: this.web3.utils.fromWei(withdrawAmount.rawValue),
        from: this.account,
        gas: 1500000,
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      });

      // Send the transaction or report failure.
      try {
        const receipt = await withdraw.send({
          from: this.account,
          gas: 1500000,
          gasPrice: this.gasEstimator.getCurrentFastPrice()
        });
        const logResult = {
          tx: receipt.transactionHash,
          caller: receipt.events.LiquidationWithdrawn.returnValues.caller,
          withdrawalAmount: receipt.events.LiquidationWithdrawn.returnValues.withdrawalAmount,
          liquidationStatus: receipt.events.LiquidationWithdrawn.returnValues.liquidationStatus
        };
        Logger.info({
          at: "Liquidator",
          message: "Withdraw tx result📄",
          liquidationResult: logResult
        });
      } catch (error) {
        Logger.error({
          at: "Liquidator",
          message: `Failed to withdraw liquidation rewards: ${error.message}`,
          error
        });
      }
    }
  };
}

module.exports = {
  Liquidator
};
