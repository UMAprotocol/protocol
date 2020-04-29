const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");

class BalanceMonitor {
  constructor(logger, tokenBalanceClient, account, botsToMonitor, walletsToMonitor) {
    this.logger = logger;
    this.account = account;

    // An array of bot objects to monitor. Each bot's `botName` `address`,
    // `CollateralThreshold` and`syntheticThreshold` must be given. Example:
    // [{ name: "Liquidator Bot",
    //   address: "0x12345"
    //   collateralThreshold: x1,
    //   syntheticThreshold: x2,
    //   etherThreshold: x3 },
    // ...]
    this.botsToMonitor = botsToMonitor;

    // An array of wallets to Monitor. Each wallet's `walletName`, `address`, `crAlert`
    // must be given. Example:
    // [{ name: "Market Making bot",
    //    address: "0x12345",
    //    crAlert: 150 },
    // ...];
    this.walletsToMonitor = walletsToMonitor;

    // Structure to monitor if a wallet address have been alerted yet for each alert type.
    this.walletsAlerted = {};

    // Populate walletsAlerted for each bot, starting with each alert type at not sent.
    for (let bot of botsToMonitor) {
      this.walletsAlerted[bot.address] = {
        collateralThreshold: false,
        syntheticThreshold: false,
        etherThreshold: false
      };
    }

    for (let wallet of walletsToMonitor) {
      this.walletsAlerted[wallet.address] = { crAlert: false };
    }

    // Instance of the tokenBalanceClient to read account balances from last change update.
    this.client = tokenBalanceClient;
    this.web3 = this.client.web3;

    this.formatDecimalString = createFormatFunction(this.web3, 2);

    // TODO: replace this with a fetcher that pulls the actual collateral token symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "UMATEST";
  }

  // Checks if a big number balance is below a given threshold.
  ltThreshold(balance, threshold) {
    // If the price has not resolved yet then return false.
    if (balance == null) {
      return false;
    }
    return this.web3.utils.toBN(balance).lt(this.web3.utils.toBN(threshold));
  }

  // A notification should only be pushed if the bot's balance is below the threshold and a notification
  // for for that threshold has not already been sent out.
  shouldPushNotification(bot, thresholdKey, balanceQueryFunction) {
    let shouldPushNotification = false;
    if (this.ltThreshold(balanceQueryFunction(bot.address), bot[thresholdKey])) {
      if (!this.walletsAlerted[bot.address][thresholdKey]) {
        shouldPushNotification = true;
      }
      this.walletsAlerted[bot.address][thresholdKey] = true;
    } else {
      this.walletsAlerted[bot.address][thresholdKey] = false;
    }

    return shouldPushNotification;
  }

  // Queries all bot ballance for collateral, synthetic and ether against specified thresholds
  checkBotBalances = async () => {
    this.logger.debug({
      at: "BalanceMonitor",
      message: "Checking bot balances"
    });

    for (let bot of this.botsToMonitor) {
      if (this.shouldPushNotification(bot, "collateralThreshold", this.client.getCollateralBalance)) {
        this.logger.info({
          at: "BalanceMonitor",
          message: "Low collateral balance warning ⚠️",
          mrkdwn: this.createLowBalanceMrkdwn(
            bot,
            bot.collateralThreshold,
            this.client.getCollateralBalance(bot.address),
            this.collateralCurrencySymbol,
            "collateral"
          )
        });
      }
      if (this.shouldPushNotification(bot, "syntheticThreshold", this.client.getSyntheticBalance)) {
        this.logger.info({
          at: "BalanceMonitor",
          message: "Low synthetic balance warning ⚠️",
          mrkdwn: this.createLowBalanceMrkdwn(
            bot,
            bot.syntheticThreshold,
            this.client.getSyntheticBalance(bot.address),
            this.syntheticCurrencySymbol,
            "synthetic"
          )
        });
      }
      if (this.shouldPushNotification(bot, "etherThreshold", this.client.getEtherBalance)) {
        this.logger.info({
          at: "BalanceMonitor",
          message: "Low Ether balance warning ⚠️",
          mrkdwn: this.createLowBalanceMrkdwn(
            bot,
            bot.etherThreshold,
            this.client.getEtherBalance(bot.address),
            "ETH",
            "ether"
          )
        });
      }
    }
  };

  // TODO: fill out this stub (next PR)
  checkWalletCrRatio = async priceFunction => {
    this.logger.debug({
      at: "BalanceMonitor",
      message: "Checking wallet collateralization radios"
    });

    for (let bot of this.botsToMonitor) {
    }
  };

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

  // Calculate the collateralization Ratio from the collateral, token amount and token price
  // This is cr = [collateral / (tokensOutstanding * price)] * 100
  calculatePositionCRPercent = (collateral, tokensOutstanding, tokenPrice) => {
    return this.web3.utils
      .toBN(collateral)
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .div(this.web3.utils.toBN(tokensOutstanding).mul(this.web3.utils.toBN(tokenPrice.toString())))
      .muln(100);
  };
}

module.exports = {
  BalanceMonitor
};
