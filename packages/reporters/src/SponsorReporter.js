const { createFormatFunction, createShortHexString } = require("@uma/common");
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

    this.lastUpdateTimestamp = 0;
    this.updateThresholdSeconds = 60;

    this.empProps = empProps;
  }

  async update() {
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (currentTimestamp < this.lastUpdateTimestamp + this.updateThresholdSeconds) {
      return;
    } else {
      await this.empClient.update();
      await this.priceFeed.update();
      this.lastUpdateTimestamp = this.empClient.lastUpdateTimestamp;
    }
  }

  // Iterate over monitored wallets and generate key metrics.
  async generateMonitoredWalletMetrics() {
    await this.update();
    console.log(
      italic("- Each monitored wallet within the configuration object has their position and token balances printed")
    );

    // Define the table rows beforehand to re-use the variables.
    const rowNames = [
      `Synthetic debt(${this.empProps.syntheticCurrencySymbol})`,
      `Backing collateral(${this.empProps.collateralCurrencySymbol})`,
      "Position CR %",
      `Synthetic balance(${this.empProps.syntheticCurrencySymbol})`,
      `Collateral balance(${this.empProps.collateralCurrencySymbol})`,
      "ETH balance"
    ];

    // Place holder object to store all table information.
    let tableInfo = {};
    rowNames.forEach(row => (tableInfo[row] = {}));

    // For each wallet monitored run through the checks and log information.
    for (let wallet of this.walletsToMonitor) {
      const position = this.empClient.getAllPositions().filter(position => position.sponsor == wallet.address);
      const currentPrice = this.priceFeed.getCurrentPrice();
      const balanceInformation = await this.tokenBalanceClient.getDirectTokenBalances(wallet.address);

      if (position.length == 0) {
        tableInfo[rowNames[0]][wallet.name] = "";
        tableInfo[rowNames[1]][wallet.name] = "";
        tableInfo[rowNames[2]][wallet.name] = "";
      } else {
        tableInfo[rowNames[0]][wallet.name] = this.formatDecimalString(position[0].numTokens);
        tableInfo[rowNames[1]][wallet.name] = this.formatDecimalString(position[0].amountCollateral);
        tableInfo[rowNames[2]][wallet.name] = this.formatDecimalString(
          this._calculatePositionCRPercent(position[0].amountCollateral, position[0].numTokens, currentPrice)
        );
      }
      tableInfo[rowNames[3]][wallet.name] = this.formatDecimalString(balanceInformation.syntheticBalance);
      tableInfo[rowNames[4]][wallet.name] = this.formatDecimalString(balanceInformation.collateralBalance);
      tableInfo[rowNames[5]][wallet.name] = this.formatDecimalString(balanceInformation.etherBalance);
    }
    console.table(tableInfo);
  }

  async generateSponsorsTable() {
    await this.update();
    console.log(italic(`- There are ${this.empClient.getAllPositions().length} current sponsors`));
    console.log(italic("- All current token sponsors within the specified EMP are printed"));

    // For all positions current open in the UMA ecosystem, generate a table.
    const currentPrice = this.priceFeed.getCurrentPrice();
    const allPositions = this.empClient.getAllPositions().sort((p1, p2) => {
      return Number(
        this._calculatePositionCRPercent(p1.amountCollateral, p1.numTokens, currentPrice)
          .sub(this._calculatePositionCRPercent(p2.amountCollateral, p2.numTokens, currentPrice))
          .div(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      );
    });

    // Define the table column headings before hand to re-use the variables.
    const colHeadings = [
      `Synthetic debt(${this.empProps.syntheticCurrencySymbol})`,
      `Backing collateral(${this.empProps.collateralCurrencySymbol})`,
      "Position CR %"
    ];

    // Place holder object to store all table information.
    let allSponsorTable = {};
    for (let position of allPositions) {
      allSponsorTable[position.sponsor] = {
        [[colHeadings[0]]]: this.formatDecimalString(position.numTokens),
        [[colHeadings[1]]]: this.formatDecimalString(position.amountCollateral),
        [[colHeadings[2]]]: this.formatDecimalString(
          this._calculatePositionCRPercent(position.amountCollateral, position.numTokens, currentPrice)
        )
      };
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
