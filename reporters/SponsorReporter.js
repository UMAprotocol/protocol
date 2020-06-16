const { createFormatFunction, createShortHexString } = require("../common/FormattingUtils");
const chalkPipe = require("chalk-pipe");
const bold = chalkPipe("bold");
const italic = chalkPipe("italic");
const dim = chalkPipe("dim");

class SponsorReporter {
  constructor(expiringMultiPartyClient, tokenBalanceClient, walletsToMonitor, priceFeed) {
    this.empClient = expiringMultiPartyClient;
    this.tokenBalanceClient = tokenBalanceClient;

    this.walletsToMonitor = walletsToMonitor;
    this.priceFeed = priceFeed;

    this.web3 = this.empClient.web3;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);

    this.collateralSymbol = "DAI";
    this.syntheticSymbol = "ETHBTC";
    this.networkId = 1;
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

    // Place holder object to store all table information.
    let tableInfo = {
      "Token debt": {},
      "Backing collateral": {},
      "Position CR %": {},
      "Synthetic balance": {},
      "Collateral balance": {},
      "ETH balance": {}
    };

    // For each wallet monitored run through the checks and log information.
    for (let wallet of this.walletsToMonitor) {
      const position = this.empClient.getAllPositions().filter(position => position.sponsor == wallet.address);
      const currentPrice = this.priceFeed.getCurrentPrice();
      const balanceInformation = await this.tokenBalanceClient.getDirectTokenBalances(wallet.address);

      if (position.length == 0) {
        tableInfo["Token debt"][wallet.name] = "";
        tableInfo["Backing collateral"][wallet.name] = "";
        tableInfo["Position CR %"][wallet.name] = "";
      } else {
        tableInfo["Token debt"][wallet.name] = this.formatDecimalString(position[0].numTokens) + this.syntheticSymbol;
        tableInfo["Backing collateral"][wallet.name] =
          this.formatDecimalString(position[0].numTokens) + this.syntheticSymbol;
        tableInfo["Position CR %"][wallet.name] =
          this.formatDecimalString(
            this._calculatePositionCRPercent(position[0].amountCollateral, position[0].numTokens, currentPrice)
          ) + "%";
      }
      tableInfo["Synthetic balance"][wallet.name] =
        this.formatDecimalString(balanceInformation.syntheticBalance) + this.syntheticSymbol;
      tableInfo["Collateral balance"][wallet.name] =
        this.formatDecimalString(balanceInformation.collateralBalance) + this.collateralSymbol;
      tableInfo["ETH balance"][wallet.name] = this.formatDecimalString(balanceInformation.etherBalance) + "ETH";
    }
    console.table(tableInfo);
  }

  async generateSponsorsTable() {
    await this.update();
    console.log(italic("- All current token sponsors within the specified EMP are printed"));

    // For all positions current open in the UMA ecosystem, generate a table.
    const allPositions = this.empClient.getAllPositions();
    const currentPrice = this.priceFeed.getCurrentPrice();

    let allSponsorTable = {};
    for (let position of allPositions) {
      allSponsorTable[position.sponsor] = {
        "Collateral(DAI)": this.formatDecimalString(position.amountCollateral),
        "Tokens borrowed(ETHBTC)": this.formatDecimalString(position.numTokens),
        "Position CR %": this.formatDecimalString(
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
