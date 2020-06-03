const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");
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

  update = async () => {
    await this.empClient.update();
    await this.priceFeed.update();
  };

  // Iterate over monitored wallets and generate key metrics.
  generateMonitoredWalletMetrics = async () => {
    await this.update();
    console.log(
      italic(
        "- Each monitored wallet within the configuration object has their position and token balances printed"
      )
    );

    // For each wallet monitored run through the checks and log information.
    for (let wallet of this.walletsToMonitor) {
      console.group();
      console.log(bold(wallet.name));
      // 1. Print information about wallets borrowed tokens, collateral and what’s the CR ratio.
      console.group();
      this._generatePositionTable(wallet.address);
      console.groupEnd();

      // 2. Print balance information about wallets including synthetic, collateral and ether balances.
      console.group();
      await this._generateTokenBalanceTable(wallet.address);
      console.groupEnd();
      // end of main group
      console.groupEnd();
    }
  };

  generateSponsorsTable = async () => {
    await this.update();
    console.log(
      italic(
        "- All current token sponsors within the spesified EMP are printed"
      )
    );

    // For all positions current open in the UMA ecosystem, generate a table.
    const allPositions = this.empClient.getAllPositions();
    const currentPrice = this.priceFeed.getCurrentPrice();

    let allSponsorTable = {};
    for (let position of allPositions) {
      allSponsorTable[position.sponsor] = {
        "Collateral(DAI)": this.formatDecimalString(position.amountCollateral),
        "Tokens borrowed(ETHBTC)": this.formatDecimalString(position.numTokens),
        "Position CR %": this.formatDecimalString(
          this._calculatePositionCRPercent(position.amountCollateral, position.numTokens, currentPrice).muln(100)
        )
      };
    }
    console.table(allSponsorTable);
  };

  _generatePositionTable(address) {
    const position = this.empClient.getAllPositions().filter(position => position.sponsor == address);
    const currentPrice = this.priceFeed.getCurrentPrice();
    console.log(italic("Position information:"));
    if (position.length == 0) {
      console.log(dim("\tWallet does not have an open position."));
    } else {
      console.table({
        "Token debt": this.formatDecimalString(position[0].numTokens) + this.syntheticSymbol,
        "Backing collateral": this.formatDecimalString(position[0].amountCollateral) + this.collateralSymbol,
        "Position CR %":
          this.formatDecimalString(
            this._calculatePositionCRPercent(position[0].amountCollateral, position[0].numTokens, currentPrice).muln(
              100
            )
          ) + "%"
      });
    }
  }

  async _generateTokenBalanceTable(address) {
    console.log("Token balance information:");
    const balanceInformation = await this.tokenBalanceClient.getDirectTokenBalances(address);
    console.table({
      "Synthetic balance": this.formatDecimalString(balanceInformation.syntheticBalance) + this.syntheticSymbol,
      "Collateral balance": this.formatDecimalString(balanceInformation.collateralBalance) + this.collateralSymbol,
      "ETH balance": this.formatDecimalString(balanceInformation.etherBalance) + "Ether"
    });
  }

  _calculatePositionCRPercent = (collateral, tokensOutstanding, tokenPrice) => {
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
      .div(this.web3.utils.toBN(tokensOutstanding).mul(this.web3.utils.toBN(tokenPrice)));
  };
}
module.exports = {
  SponsorReporter
};
