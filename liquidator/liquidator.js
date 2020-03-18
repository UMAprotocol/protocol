// When running this script it assumed that the account has enough tokens and allowance from the unlocked truffle
// wallet to run the liquidations. Future versions will deal with generating additional synthetic tokens from EMPs as the bot needs.

const { Logger } = require("../financial-templates-lib/Logger");

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
      at: "liquidator",
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

    if (underCollateralizedPositions.length > 0) {
      for (const underCollateralizedPosition of underCollateralizedPositions) {
        Logger.info({
          at: "liquidator",
          message: "undercollateralized positions detected 🚨",
          underCollateralizedPosition: underCollateralizedPosition
        });
      }
    } else {
      Logger.debug({
        at: "liquidator",
        message: "No undercollateralized position"
      });
    }

    let liquidationPromises = []; // store all promises to resolve in parallel later on.
    for (const position of underCollateralizedPositions) {
      // TODO: add additional information about this liquidation event to the log.
      Logger.info({
        at: "liquidator",
        message: "liquidating sponsor 🔥",
        address: position.sponsor,
        gasPrice: this.gasEstimator.getCurrentFastPrice()
      });

      // Create the liquidation transaction to liquidate the entire position:
      // - Price to liquidate at (`collateralPerToken`): Since you are determining which positions are under collateralized positions based on the priceFeed,
      // you also should be liquidating using that priceFeed.
      // - Maximum amount of Synthetic tokens to liquidate: Liquidate the entire position.
      liquidationPromises.push(
        this.empContract.methods
          .createLiquidation(
            position.sponsor,
            { rawValue: this.web3.utils.toWei(priceFeed) },
            { rawValue: position.numTokens }
          )
          .send({
            from: this.account,
            gas: 1500000,
            gasPrice: this.gasEstimator.getCurrentFastPrice()
          })
      );
    }
    // Resolve all promises in parallel.
    let promiseResponse = await Promise.all(liquidationPromises);

    for (const response of promiseResponse) {
      const logResult = {
        tx: response.transactionHash,
        sponsor: response.events.LiquidationCreated.returnValues.sponsor,
        liquidator: response.events.LiquidationCreated.returnValues.liquidator,
        liquidationId: response.events.LiquidationCreated.returnValues.liquidationId,
        tokensOutstanding: response.events.LiquidationCreated.returnValues.tokensOutstanding,
        lockedCollateral: response.events.LiquidationCreated.returnValues.lockedCollateral,
        liquidatedCollateral: response.events.LiquidationCreated.returnValues.liquidatedCollateral
      };
      Logger.info({
        at: "liquidator",
        message: "liquidation tx result 🤕",
        liquidationResult: logResult
      });
    }
  };

  // Queries ongoing liquidations and attempts to withdraw rewards from both expired and disputed liquidations.
  queryAndWithdrawRewards = async () => {
    Logger.debug({
      at: "liquidator",
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
    const potentialWithdrawableLiquidations = expiredLiquidations.concat(disputedLiquidations);

    if (potentialWithdrawableLiquidations.length > 0) {
      Logger.info({
        at: "liquidator",
        message: "potential withdrawable liquidations detected!",
        number: potentialWithdrawableLiquidations.length,
        potentialWithdrawableLiquidations: potentialWithdrawableLiquidations
      });

      // Save all withdraw promises to resolve in parallel later on.
      const withdrawPromises = [];
      for (const liquidation of potentialWithdrawableLiquidations) {
        Logger.info({
          at: "liquidator",
          message: "attempting to withdraw rewards from liquidations💪",
          address: liquidation.sponsor,
          id: liquidation.id
        });

        // Confirm that liquidation has eligible rewards to be withdrawn.
        try {
          let withdraw = this.empContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor);
          let withdrawAmount = await withdraw.call({ from: this.account });
          if (this.web3.utils.toBN(withdrawAmount.rawValue).gt("0")) {
            withdrawPromises.push(
              withdraw.send({
                from: this.account,
                gas: 1500000,
                gasPrice: this.gasEstimator.getCurrentFastPrice()
              })
            );
          }
        } catch (err) {
          Logger.error({
            at: "liquidator",
            message: "failed to withdraw rewards from liquidation🤷‍♂️",
            address: liquidation.sponsor,
            id: liquidation.id
          });
          continue;
        }
      }

      // Resolve all promises in parallel.
      let promiseResponse = await Promise.all(withdrawPromises);

      for (const response of promiseResponse) {
        const logResult = {
          tx: response.transactionHash,
          caller: response.events.LiquidationWithdrawn.returnValues.caller,
          withdrawalAmount: response.events.LiquidationWithdrawn.returnValues.withdrawalAmount,
          liquidationStatus: response.events.LiquidationWithdrawn.returnValues.liquidationStatus
        };
        Logger.info({
          at: "liquidator",
          message: "withdraw tx result📄",
          liquidationResult: logResult
        });
      }
    } else {
      Logger.debug({
        at: "liquidator",
        message: "No withdrawable liquidations"
      });
    }
  };
}

module.exports = {
  Liquidator
};
