const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");
const chalkPipe = require("chalk-pipe");
const blue = chalkPipe("blue");
const bold = chalkPipe("bold");

class SponsorReporter {
  constructor(expiringMultiPartyClient, walletsToMonitor, priceFeed) {
    this.empClient = expiringMultiPartyClient;
    this.walletsToMonitor = walletsToMonitor;
    this.priceFeed = priceFeed;

    this.web3 = this.empClient.web3;

    this.formatDecimalString = createFormatFunction(this.web3, 2);

    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "ETHBTC";
  }

  update = async () => {
    await this.empClient.update();
    await this.priceFeed.update();
  };

  getMonitoredWalletMetrics = async () => {
    console.log(blue("Monitored wallets Risk metrics:😅"));
    await this.update();
    for (let wallet of this.walletsToMonitor) {
      console.group();
      console.log(bold(wallet.name));

      const position = this.empClient.getAllPositions().filter(position => position.sponsor == wallet.address);
      if (position.length == 0) {
        console.log("Wallet does not have an open position.");
      } else {
        console.log("Position information");
        console.table({
          "Token Debt": this.formatDecimalString(position[0].numTokens) + this.syntheticCurrencySymbol,
          "Backing Collateral": this.formatDecimalString(position[0].amountCollateral) + this.collateralCurrencySymbol
        });
      }

      console.groupEnd();
    }
  };
}
module.exports = {
  SponsorReporter
};
