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
<<<<<<< HEAD
        message: "liquidating sponsor 🔥",
=======
        message: "liquidating sponsor",
>>>>>>> master
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
    Logger.info({
      at: "liquidator",
      message: "Checking for liquidations",
      inputPrice: priceFeed
    });

    // Update the client to get the latest information.
    await this.empClient._update();

    // TODO: Just showing an example of how I want to use the client:
    // Get expired liquidations from the client.
    const expiredLiquidations = this.empClient.getExpiredLiquidations();
    // TODO: 
    // - Withdraw rewards
    // - Check that amount of rewards was correct.

    // Get disputed liquidations from the client.
    const disputedLiquidations = this.empClient.getDisputedLiquidations();
    // TODO: 
    // - Withdraw rewards
    // - Check whether it was a successful or failed dispute and double check that the reward amount was correct
  }
}

module.exports = {
  Liquidator
};
