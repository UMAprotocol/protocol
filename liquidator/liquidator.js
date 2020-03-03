// When running this script it assumes to have enough tokens and allowance from the unlocked truffle wallet.
// Future versions will deal with generating additional synthetic tokens from EMPs as the bot needs.
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
    await this.empClient._update();
    const underCollateralizedPositions = this.empClient.getUnderCollateralizedPositions(priceFeed);
    console.log("Undercollateralized positions:", underCollateralizedPositions);

    for (const position of underCollateralizedPositions) {
      console.log("Liquidating sponsor", position.sponsor);
      // Create the liquidation transaction

      // TODO calculate the amountToLiquidate as a function of the total collateral within the position
      // and the current price of the collateral. This will require knowing how much the collateral and the
      // synthetic are worth.

      this.empContract.methods
        .createLiquidation(position.sponsor, {
          rawValue: position.amountCollateral
        })
        .send({ from: this.account, gas: 1500000 })
        .then(transaction => {
          console.log("Liquidation transaction hash", transaction);
        });
    }
  };
}

module.exports = {
  Liquidator
};
