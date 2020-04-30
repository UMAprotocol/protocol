const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");

// This module is used to monitor a list of addresses and their associated Collateralization ratio.
class CRMonitor {
  // @param logger an instance of a winston logger used to emit messages, logs and errors.
  // @param expiringMultiPartyClient is an instance of the expiringMultiPartyClient from the `financial-templates lib
  // which provides synchronous access to positions opened against an expiring multiparty
  // @param walletsToMonitor  An array of wallets to Monitor. Each wallet's `walletName`, `address`, `crAlert` must be given.
  //  [{ name: "Market Making bot",
  //    address: "0x12345",
  //    crAlert: 150 },
  // ...];
  constructor(logger, expiringMultiPartyClient, walletsToMonitor) {
    this.logger = logger;

    // An array of wallets to Monitor. Each wallet's `walletName`, `address`, `crAlert`
    // must be given. Example:
    // [{ name: "Market Making bot",
    //    address: "0x12345",
    //    crAlert: 150 },
    // ...];
    this.walletsToMonitor = walletsToMonitor;

    this.empClient = expiringMultiPartyClient;
    this.empContract = this.empClient.emp;
    this.web3 = this.empClient.web3;

    // Structure to monitor if a wallet address have been alerted yet for each alert type.
    this.walletsAlerted = {};

    for (let wallet of walletsToMonitor) {
      this.walletsAlerted[wallet.address] = { crAlert: false };
    }

    this.formatDecimalString = createFormatFunction(this.web3, 2);

    // TODO: replace this with a fetcher that pulls the actual collateral token symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "UMATEST";
  }

  // Queries all monitored wallet ballance for collateralization ratio against a given threshold
  checkWalletCrRatio = async priceFunction => {
    // yield the price feed at the current time.
    const contractTime = await this.empContract.methods.getCurrentTime().call();
    const priceFeed = priceFunction(contractTime);
    this.logger.debug({
      at: "CRMonitor",
      message: "Checking wallet collateralization radios",
      price: priceFeed
    });
    // For each monitored wallet check if the current collaterlization ratio is below the monitored threshold.
    // If it is, then send an alert of formatted markdown text.
    for (let wallet of this.walletsToMonitor) {
      const [shouldPush, crRatio] = this.shouldPushWalletNotification(wallet, priceFeed);
      if (shouldPush) {
        // Sample message:
        // Risk alert: [Tracked wallet name] has fallen below [threshold]%.
        // Current [name of identifier] value: [current identifier value].
        const mrkdwn =
          wallet.name +
          " (" +
          createEtherscanLinkMarkdown(this.web3, wallet.address) +
          ") collateralization ratio has dropped to " +
          this.formatDecimalString(crRatio) +
          "% which is below the " +
          wallet.crAlert +
          "% threshold. Current value of " +
          this.syntheticCurrencySymbol +
          " is " +
          this.formatDecimalString(priceFeed);

        this.logger.info({
          at: "ContractMonitor",
          message: "Collateralization ratio alert 🚨!",
          mrkdwn: mrkdwn
        });
      }
    }
  };

  getPositionInformation = address => {
    const positionInfo = this.empClient.getAllPositions().filter(position => position.sponsor == address);
    if (positionInfo.length == 0) {
      return null;
      // there should only ever be one position information object per address
    } else return positionInfo[0];
  };

  shouldPushWalletNotification(wallet, priceFeed) {
    const positionInformation = this.getPositionInformation(wallet.address);
    if (positionInformation == null) {
      // There is no position information for the given wallet.
      return [false, 0];
    }

    const collateral = positionInformation.amountCollateral;
    const tokensOutstanding = positionInformation.numTokens;

    // If the values for collateral or price have yet to resolve, dont push a notification
    if (collateral == null || tokensOutstanding == null) {
      return [false, 0];
    }

    // If CR = null then there are no tokens outstanding and so dont push a notification
    const positionCR = this.calculatePositionCRPercent(collateral, tokensOutstanding, priceFeed);
    if (positionCR == null) {
      return [false, 0];
    }

    let shouldPushWalletNotification = false;
    if (this.ltThreshold(positionCR, this.web3.utils.toWei(wallet.crAlert.toString()))) {
      if (!this.walletsAlerted[wallet.address].crAlert) {
        shouldPushWalletNotification = true;
      }
      this.walletsAlerted[wallet.address].crAlert = true;
    } else {
      this.walletsAlerted[wallet.address].crAlert = false;
    }
    return [shouldPushWalletNotification, positionCR];
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

  // TODO: refactor this out into a selerate utility function
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
  CRMonitor
};
