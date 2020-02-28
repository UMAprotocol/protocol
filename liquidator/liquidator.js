// When running this script it assumes to have enough tokens and allowance from the unlocked truffle wallet.
// Future versions will deal with generating additional synthetic tokens from EMPs as the bot needs.
const { ExpiringMultiPartyClient } = require("../financial-templates-lib/ExpiringMultiPartyClient.js");

const ExpiringMultiParty = artifacts.require("ExpiringMultiParty");

class Liquidator {
  constructor(abi, web3, empAddress) {
    this.empAddress = empAddress;
    web3.eth.getAccounts().then(accounts => {
      this.account = accounts[0];
      console.log(this.account);
    });

    // Expiring multiparty contract to read contract state
    this.empClient = new ExpiringMultiPartyClient(abi, web3, empAddress);
    this.empClient.start();

    // Instance of the expiring multiparty to perform on-chain liquidations
    this.empContract = new web3.eth.Contract(abi, empAddress);
  }

  // Queries underCollateralized positions and performs liquidations against any under collateralized positions.
  queryAndLiquidate = async priceFeed => {
    console.log("Checking for under collateralized positions at the price", priceFeed);
    await this.empClient._update();
    const underCollateralizedPositions = this.empClient.getUnderCollateralizedPositions(priceFeed);
    console.log("UNDER COLLATERALIZED POSITIONS:", underCollateralizedPositions);

    for (let i = 0; i < underCollateralizedPositions.length; i++) {
      console.log("Liquidating sponsor", underCollateralizedPositions[i].sponsor);
      // Create the liquidation transaction
      // TODO calculate the amountToLiquidate as a function of the total collateral within the position
      // and the current price of the collateral. This will require knowing how much the collateral and the
      // synthetic are worth.
      this.empContract.methods
        .createLiquidation(underCollateralizedPositions[i].sponsor, {
          rawValue: underCollateralizedPositions[i].amountCollateral
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
