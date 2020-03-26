const { Logger } = require("../financial-templates-lib/logger/Logger");

class Disputer {
  constructor(expiringMultiPartyClient, gasEstimator, account) {
    this.account = account;

    // Expiring multiparty contract to read contract state
    this.empClient = expiringMultiPartyClient;

    // Gas Estimator to calculate the current Fast gas rate
    this.gasEstimator = gasEstimator;

    // Instance of the expiring multiparty to perform on-chain disputes
    this.empContract = this.empClient.emp;
    this.web3 = this.empClient.web3;
  }

  // Queries disputable liquidations and disputes any that were incorrectly liquidated.
  queryAndDispute = async priceFunction => {
    Logger.debug({
      at: "Disputer",
      message: "Checking for any disputable liquidations"
    });

    // Update the client to get the latest liquidation information.
    await this.empClient._update();

    // Update the gasEstimator to get the latest gas price data.
    // If the client has a data point in the last 60 seconds returns immediately.
    await this.gasEstimator._update();

    // Get the latest disputable liquidations from the client.
    const undisputedLiquidations = this.empClient.getUndisputedLiquidations();
    const disputeableLiquidations = undisputedLiquidations.filter(liquidation =>
      this.empClient.isDisputable(liquidation, priceFunction(liquidation.liquidationTime))
    );

    if (disputeableLiquidations.length === 0) {
      Logger.debug({
        at: "Disputer",
        message: "No disputable liquidations"
      });

      // Nothing left to do, so return.
      return;
    }

    Logger.info({
      at: "Disputer",
      message: "Disputable liquidation(s) detected!🚨",
      number: disputeableLiquidations.length,
      disputeableLiquidations: disputeableLiquidations
    });

    for (const disputeableLiquidation of disputeableLiquidations) {
      Logger.info({
        at: "Disputer",
        message: "Disputing liquidation🔥",
        address: disputeableLiquidation.sponsor,
        inputPrice: priceFunction(disputeableLiquidation.liquidationTime)
      });

      // Create the liquidation transaction.
      const dispute = this.empContract.methods.dispute(disputeableLiquidation.id, disputeableLiquidation.sponsor);

      // Simple version of inventory management: simulate the transaction and assume that if it fails, the caller didn't have enough collateral.
      try {
        await dispute.call({ from: this.account, gasPrice: this.gasEstimator.getCurrentFastPrice() });
      } catch (error) {
        Logger.error({
          at: "Disputer",
          message: "Cannot dispute liquidation: not enough collateral (or large enough approval) to initiate dispute.",
          id: disputeableLiquidation.id,
          sponsor: disputeableLiquidation.sponsor,
        });
        Logger.debug({
          at: "Disputer",
          message: `Dispute call error message: ${error.message}`,
          error
        });
        continue;
      }

      // Send the transaction or report failure.
      try {
        const receipt = await dispute.send({
          from: this.account,
          gas: 1500000,
          gasPrice: this.gasEstimator.getCurrentFastPrice()
        })
        const logResult = {
          tx: receipt.transactionHash,
          sponsor: receipt.events.LiquidationDisputed.returnValues.sponsor,
          liquidator: receipt.events.LiquidationDisputed.returnValues.liquidator,
          id: receipt.events.LiquidationDisputed.returnValues.disputeId,
          disputeBondPaid: receipt.events.LiquidationDisputed.returnValues.disputeBondAmount
        };  
        Logger.info({
          at: "Disputer",
          message: "Dispute tx result📄",
          disputeResult: logResult
        });  
      } catch (error) {
        Logger.error({
          at: "Disputer",
          message: `Failed to dispute liquidation: ${error.message}`,
          error
        });
      }
    }
  };

  // Queries ongoing disputes and attempts to withdraw any pending rewards from them.
  queryAndWithdrawRewards = async () => {
    Logger.debug({
      at: "Disputer",
      message: "Checking for disputed liquidations that may have resolved"
    });

    // Update the client to get the latest information.
    await this.empClient._update();

    // Update the gasEstimator to get the latest gas price data.
    // If the client has a data point in the last 60 seconds returns immediately.
    await this.gasEstimator._update();

    // Can only derive rewards from disputed liquidations that this account disputed.
    const disputedLiquidations = this.empClient
      .getDisputedLiquidations()
      .filter(liquidation => liquidation.disputer === this.account);

    if (disputedLiquidations.length === 0) {
      Logger.debug({
        at: "Disputer",
        message: "No withdrawable liquidations"
      });
      return;
    }

    for (const liquidation of disputedLiquidations) {
      Logger.info({
        at: "Disputer",
        message: "Attempting to withdraw from previous dispute.💪",
        address: liquidation.sponsor,
        id: liquidation.id
      });

      const withdraw = this.empContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor);

      // Attempt to compute the withdraw amount. If the dispute has failed or has not been resolved (DVM has not returned a price), this should fail.
      // In that case, just continue because there is nothing left to do.
      let withdrawAmount;
      try {
        withdrawAmount = await withdraw.call({ from: this.account });
      } catch (error) {
        Logger.debug({
          at: "Disputer",
          message: "No rewards to withdraw.",
          address: liquidation.sponsor,
          id: liquidation.id
        });
        Logger.debug({
          at: "Disputer",
          message: `Withdraw dispute error message: ${error.message}`,
          error
        });
        continue;
      }

      // Send the transaction or report failure.
      try {
        const receipt = await withdraw.send({
          from: this.account,
          gas: 1500000,
          gasPrice: this.gasEstimator.getCurrentFastPrice()
        })
        const logResult = {
          tx: receipt.transactionHash,
          caller: receipt.events.LiquidationWithdrawn.returnValues.caller,
          withdrawalAmount: receipt.events.LiquidationWithdrawn.returnValues.withdrawalAmount,
          liquidationStatus: receipt.events.LiquidationWithdrawn.returnValues.liquidationStatus
        };
        Logger.info({
          at: "Disputer",
          message: "Withdraw tx result📄",
          liquidationResult: logResult
        });  
      } catch (error) {
        Logger.error({
          at: "Disputer",
          message: `Failed to withdraw liquidation rewards: ${error.message}`,
          error
        });
      }
    }
  };
}

module.exports = {
  Disputer
};
