// When running this script it assumed that the account has enough tokens and allowance from the unlocked truffle
// wallet to run the liquidations. Future versions will deal with generating additional synthetic tokens from EMPs as the bot needs.

const { Logger } = require("../financial-templates-lib/Logger");

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
    console.log("Checking for under collateralized positions at the price", priceFeed);
    Logger.info({
      at: "liquidator",
      message: "Checking for under collateralized positions"
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

      // Create the liquidation transaction

      // TODO calculate the amountToLiquidate as a function of the total collateral within the position
      // and the current price of the collateral. This will require knowing how much the collateral and the
      // synthetic are worth.

      liquidationPromises.push(
        this.empContract.methods
          .createLiquidation(position.sponsor, {
            rawValue: position.amountCollateral
          })
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
}

module.exports = {
  Liquidator
};
