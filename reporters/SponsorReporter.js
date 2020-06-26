const { createFormatFunction, createShortHexString } = require("../common/FormattingUtils");
const chalkPipe = require("chalk-pipe");
const bold = chalkPipe("bold");
const italic = chalkPipe("italic");
const dim = chalkPipe("dim");

class SponsorReporter {
  constructor(expiringMultiPartyClient, tokenBalanceClient, walletsToMonitor, priceFeed, empProps) {
    this.empClient = expiringMultiPartyClient;
    this.tokenBalanceClient = tokenBalanceClient;

    this.walletsToMonitor = walletsToMonitor;
    this.priceFeed = priceFeed;

    this.web3 = this.empClient.web3;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);

    this.empProps = empProps;
  }

  async update() {
    await this.empClient.update();
    await this.priceFeed.update();
  }

  // Iterate over monitored wallets and generate key metrics.
  async generateMonitoredWalletMetrics() {
    await this.update();
    console.log(
      italic("- Each monitored wallet within the configuration object has their position and token balances printed")
    );

    // Define the table rows beforehand to re-use the variables.
    const row1Name = `Synthetic debt(${this.empProps.syntheticCurrencySymbol})`;
    const row2Name = `Backing collateral${this.empProps.collateralCurrencySymbol})`;
    const row3Name = "Position CR %";
    const row4Name = `Synthetic balance(${this.empProps.syntheticCurrencySymbol})`;
    const row5Name = `Collateral balance(${this.empProps.collateralCurrencySymbol})`;
    const row6Name = "ETH balance";

    // Place holder object to store all table information.
    let tableInfo = {};
    tableInfo[row1Name] = {};
    tableInfo[row2Name] = {};
    tableInfo[row3Name] = {};
    tableInfo[row4Name] = {};
    tableInfo[row5Name] = {};
    tableInfo[row6Name] = {};

    // For each wallet monitored run through the checks and log information.
    for (let wallet of this.walletsToMonitor) {
      const position = this.empClient.getAllPositions().filter(position => position.sponsor == wallet.address);
      const currentPrice = this.priceFeed.getCurrentPrice();
      const balanceInformation = await this.tokenBalanceClient.getDirectTokenBalances(wallet.address);

      if (position.length == 0) {
        tableInfo[row1Name][wallet.name] = "";
        tableInfo[row2Name][wallet.name] = "";
        tableInfo[row3Name][wallet.name] = "";
      } else {
        tableInfo[row1Name][wallet.name] = this.formatDecimalString(position[0].numTokens);
        tableInfo[row2Name][wallet.name] = this.formatDecimalString(position[0].numTokens);
        tableInfo[row3Name][wallet.name] = this.formatDecimalString(
          this._calculatePositionCRPercent(position[0].amountCollateral, position[0].numTokens, currentPrice)
        );
      }
      tableInfo[row4Name][wallet.name] = this.formatDecimalString(balanceInformation.syntheticBalance);
      tableInfo[row5Name][wallet.name] = this.formatDecimalString(balanceInformation.collateralBalance);
      tableInfo[row6Name][wallet.name] = this.formatDecimalString(balanceInformation.etherBalance);
    }
    console.table(tableInfo);
  }

  async generateSponsorsTable() {
    await this.update();
    console.log(italic("- All current token sponsors within the specified EMP are printed"));

    // For all positions current open in the UMA ecosystem, generate a table.
    const allPositions = this.empClient.getAllPositions();
    const currentPrice = this.priceFeed.getCurrentPrice();

    // Define the table column headings before hand to re-use the variables.
    const col1Heading = `Synthetic debt(${this.empProps.syntheticCurrencySymbol})`;
    const col2Heading = `Backing collateral(${this.empProps.collateralCurrencySymbol})`;
    const col3Heading = "Position CR %";

    // Place holder object to store all table information.
    let allSponsorTable = {};
    for (let position of allPositions) {
      allSponsorTable[position.sponsor] = {};
      allSponsorTable[position.sponsor][col1Heading] = this.formatDecimalString(position.numTokens);
      allSponsorTable[position.sponsor][col2Heading] = this.formatDecimalString(position.amountCollateral);
      allSponsorTable[position.sponsor][col3Heading] = this.formatDecimalString(
        this._calculatePositionCRPercent(position.amountCollateral, position.numTokens, currentPrice)
      );
    }
    console.table(allSponsorTable);
  }

  _calculatePositionCRPercent(collateral, tokensOutstanding, tokenPrice) {
    if (collateral == 0) {
      return 0;
    }
    if (tokensOutstanding == 0) {
      return null;
    }
    return this.web3.utils
      .toBN(collateral)
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .div(this.web3.utils.toBN(tokensOutstanding).mul(this.web3.utils.toBN(tokenPrice)))
      .muln(100);
  }
}
module.exports = {
  SponsorReporter
};
