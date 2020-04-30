const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");

class CollateralizationRatioMonitor {
  constructor(logger, expiringMultiPartyClient, account, walletsToMonitor) {
    this.logger = logger;
    this.account = account;

    // An array of wallets to Monitor. Each wallet's `walletName`, `address`, `crAlert`
    // must be given. Example:
    // [{ name: "Market Making bot",
    //    address: "0x12345",
    //    crAlert: 150 },
    // ...];
    this.walletsToMonitor = walletsToMonitor;

    this.empClient = expiringMultiPartyClient;

    // Structure to monitor if a wallet address have been alerted yet for each alert type.
    this.walletsAlerted = {};

    for (let wallet of walletsToMonitor) {
      this.walletsAlerted[wallet.address] = { crAlert: false };
    }

    // Instance of the tokenBalanceClient to read account balances from last change update.
    this.client = expiringMultiPartyClient;
    this.web3 = this.client.web3;

    this.formatDecimalString = createFormatFunction(this.web3, 2);

    // TODO: replace this with a fetcher that pulls the actual collateral token symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "UMATEST";
  }

  checkWalletCrRatio = async priceFunction => {
    console.log("checking CR");
    const contractTime = await this.empContract.methods.getCurrentTime().call();
    const priceFeed = priceFunction(contractTime);
    console.log("priceFeed", priceFeed);
    this.logger.debug({
      at: "BalanceMonitor",
      message: "Checking wallet collateralization radios",
      price: priceFeed
    });

    for (let wallet of this.walletsToMonitor) {
      console.log(wallet);
      if (this.shouldPushWalletNotification(wallet, priceFeed)) {
        console.log("WALLET UNDER CR");
      } else {
        console.log("WALLET NOT UNDER CR");
      }
    }
  };

  shouldPushWalletNotification(wallet, priceFeed) {
    const collateral = this.client.getCollateralBalance(wallet.address);
    const tokensOutstanding = this.client.getSyntheticBalance(wallet.address);

    // If the values for collateral or price have yet to resolve, dont push a notification
    if (collateral == null || tokensOutstanding == null) {
      return false;
    }

    // If CR = null then there are no tokens outstanding and so dont push a notification
    const positionCR = this.calculatePositionCRPercent(collateral, tokensOutstanding, priceFeed);
    if (positionCR == null) {
      return false;
    }

    let shouldPushWalletNotification = false;
    if (this.ltThreshold(positionCR, this.web3.utils.toWei(wallet.crAlert.toString()))) {
      if (!this.walletsAlerted[wallet.address]["crAlert"]) {
        shouldPushWalletNotification = true;
      }
      this.walletsAlerted[wallet.address]["crAlert"] = true;
    } else {
      this.walletsAlerted[wallet.address]["crAlert"] = false;
    }
    return shouldPushWalletNotification;
  }

  createLowBalanceMrkdwn = (bot, threshold, tokenBalance, tokenSymbol, tokenName) => {
    return (
      "*" +
      bot.name +
      "* (" +
      createEtherscanLinkMarkdown(this.web3, bot.address) +
      ") " +
      tokenName +
      " balance is less than " +
      this.formatDecimalString(threshold) +
      " " +
      tokenSymbol +
      ". Current balance is " +
      this.formatDecimalString(tokenBalance) +
      " " +
      tokenSymbol
    );
  };

  // Checks if a big number value is below a given threshold.
  ltThreshold(value, threshold) {
    // If the price has not resolved yet then return false.
    if (value == null) {
      return false;
    }
    return this.web3.utils.toBN(value).lt(this.web3.utils.toBN(threshold));
  }

  // Calculate the collateralization Ratio from the collateral, token amount and token price
  // This is cr = [collateral / (tokensOutstanding * price)] * 100
  calculatePositionCRPercent = (collateral, tokensOutstanding, tokenPrice) => {
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
      .muln(100)
      .toString();
  };
}

module.exports = {
  BalanceMonitor
};
