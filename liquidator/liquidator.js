// When running this script it assumed that the account has enough tokens and allowance from the unlocked truffle
// wallet to run the liquidations. Future versions will deal with generating additional synthetic tokens from EMPs as the bot needs.

const { Logger } = require("../financial-templates-lib/Logger");
const { toWei, toBN } = web3.utils;

class Liquidator {
  constructor(expiringMultiPartyClient, account) {
    this.account = account;

    // Expiring multiparty contract to read contract state
    this.empClient = expiringMultiPartyClient;

    // Instance of the expiring multiparty to perform on-chain liquidations
    this.empContract = this.empClient.emp;
  }

  // Queries underCollateralized positions and performs liquidations against any under collateralized positions.
  queryAndLiquidate = async priceFeed => {
    Logger.info({
      at: "liquidator",
      message: "Checking for under collateralized positions",
      inputPrice: priceFeed
    });

    // Update the client to get the latest position information.
    await this.empClient._update();

    // Get the latest undercollateralized positions from the client.
    const underCollateralizedPositions = this.empClient.getUnderCollateralizedPositions(priceFeed);

    if (underCollateralizedPositions.length > 0) {
      Logger.info({
        at: "liquidator",
        message: "undercollateralized positions detected!",
        number: underCollateralizedPositions.length,
        underCollateralizedPositions: underCollateralizedPositions
      });
    } else {
      Logger.info({
        at: "liquidator",
        message: "No undercollateralized position"
      });
    }

    let liquidationPromises = []; // store all promises to resolve in parallel later on.
    for (const position of underCollateralizedPositions) {
      // TODO: add additional information about this liquidation event to the log.
      Logger.info({
        at: "liquidator",
        message: "liquidating sponsor",
        address: position.sponsor
      });

      // Create the liquidation transaction to liquidate the entire position:
      // - Price to liquidate at (`collateralPerToken`): Since you are determining which positions are under collateralized positions based on the priceFeed, 
      // you also should be liquidating using that priceFeed.
      // - Maximum amount of Synthetic tokens to liquidate: Liquidate the entire position.
      liquidationPromises.push(
        this.empContract.methods
          .createLiquidation(
            position.sponsor, 
            { rawValue: toWei(priceFeed) },
            { rawValue: position.numTokens }
          )
          .send({ from: this.account, gas: 1500000 })
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
        message: "liquidation tx result",
        liquidationResult: logResult
      });
    }
  };

  // Queries ongoing liquidations and attempts to withdraw rewards from both expired and disputed liquidations.
  queryAndWithdrawRewards = async () => {
    Logger.info({
      at: "liquidator",
      message: "Checking for expired and disputed liquidations to withdraw rewards from"
    });

    // Update the client to get the latest information.
    await this.empClient._update();

    let withdrawPromises = []; // store all promises to resolve in parallel later on.

    // Get all expired liquidations from the client.
    const expiredLiquidations = this.empClient.getExpiredLiquidations();
    if (expiredLiquidations.length > 0) {
      Logger.info({
        at: "liquidator",
        message: "expired liquidations detected!",
        number: expiredLiquidations.length,
        expiredLiquidations: expiredLiquidations
      });
    } else {
      Logger.info({
        at: "liquidator",
        message: "No expired liquidations"
      });
    }
    for (const liquidation of expiredLiquidations) {
      Logger.info({
        at: "liquidator",
        message: "withdrawing rewards from expired liquidation",
        address: liquidation.sponsor,
        id: liquidation.id
      });

      // Confirm that liquidation has eligible rewards to be withdrawn.
      let withdrawPromise = this.empContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor)
      let withdrawAmount = await withdrawPromise.call({ from: this.account })
      if (toBN(withdrawAmount.rawValue).gt('0')) {
        // TODO(#1062): Determine this gas price dynamically.
        withdrawPromises.push(
          withdrawPromise.send({ from: this.account, gas: 1500000 })
        )
      }
    }

    // Get all disputed liquidations from the client.
    const disputedLiquidations = this.empClient.getDisputedLiquidations();
    if (disputedLiquidations.length > 0) {
      Logger.info({
        at: "liquidator",
        message: "disputed liquidations detected!",
        number: disputedLiquidations.length,
        disputedLiquidations: disputedLiquidations
      });
    } else {
      Logger.info({
        at: "liquidator",
        message: "No disputed liquidations"
      });
    }
    for (const liquidation of disputedLiquidations) {
      Logger.info({
        at: "liquidator",
        message: "withdrawing rewards from disputed liquidation",
        address: liquidation.sponsor,
        id: liquidation.id
      });

      // Confirm that liquidation has eligible rewards to be withdrawn.
      let withdrawPromise = this.empContract.methods.withdrawLiquidation(liquidation.id, liquidation.sponsor)
      let withdrawAmount = await withdrawPromise.call({ from: this.account })
      if (toBN(withdrawAmount.rawValue).gt('0')) {
        // TODO(#1062): Determine this gas price dynamically.
        withdrawPromises.push(
          withdrawPromise.send({ from: this.account, gas: 1500000 })
        )
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
        message: "withdraw tx result",
        liquidationResult: logResult
      });
    }
  }
}

module.exports = {
  Liquidator
};
