const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");

// This module is used to monitor a list of addresses and their associated collateral, synthetic and ether balances.
class BalanceMonitor {
  // @param logger an instance of a winston logger used to emit messages, logs and errors.
  // @param tokenBalanceClient is an instance of the TokenBalanceClient from the `financial-templates lib
  // which provides synchronous access to address balances for a given expiring multi party contract.
  // @param botsToMonitor is array of bot objects to monitor. Each bot's `botName` `address`,
  // `CollateralThreshold` and`syntheticThreshold` must be given. Example:
  // [{ name: "Liquidator Bot",
  //   address: "0x12345"
  //   collateralThreshold: x1,
  //   syntheticThreshold: x2,
  //   etherThreshold: x3 },
  // ...]
  constructor(logger, tokenBalanceClient, botsToMonitor) {
    this.logger = logger;

    // Instance of the tokenBalanceClient to read account balances from last change update.
    this.client = tokenBalanceClient;
    this.web3 = this.client.web3;

    this.botsToMonitor = botsToMonitor;

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

    this.formatDecimalString = createFormatFunction(this.web3, 2);

    // TODO: replace this with a fetcher that pulls the actual collateral token symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "UMATEST";
  }

  // Queries all bot ballance for collateral, synthetic and ether against specified thresholds
  checkBotBalances = async () => {
    this.logger.debug({
      at: "BalanceMonitor",
      message: "Checking bot balances"
    });

    // Loop over all the bot objects specified to monitor in the this.botsToMonitor object and for each bot
    // check if their collateral, synthetic or ether balance is below a given threshold. If it is, then
    // send a winston event. The message structure is defined with the `_createLowBalanceMrkdwn` formatter.
    for (let bot of this.botsToMonitor) {
      if (this._shouldPushBotNotification(bot, "collateralThreshold", this.client.getCollateralBalance)) {
        this.logger.info({
          at: "BalanceMonitor",
          message: "Low collateral balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.collateralThreshold,
            this.client.getCollateralBalance(bot.address),
            this.collateralCurrencySymbol,
            "collateral"
          )
        });
      }
      if (this._shouldPushBotNotification(bot, "syntheticThreshold", this.client.getSyntheticBalance)) {
        this.logger.info({
          at: "BalanceMonitor",
          message: "Low synthetic balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.syntheticThreshold,
            this.client.getSyntheticBalance(bot.address),
            this.syntheticCurrencySymbol,
            "synthetic"
          )
        });
      }
      if (this._shouldPushBotNotification(bot, "etherThreshold", this.client.getEtherBalance)) {
        this.logger.info({
          at: "BalanceMonitor",
          message: "Low Ether balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
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

  // A notification should only be pushed if the bot's balance is below the threshold and a notification
  // for for that threshold has not already been sent out.
  _shouldPushBotNotification(bot, thresholdKey, balanceQueryFunction) {
    let shouldPushBotNotification = false;
    if (this._ltThreshold(balanceQueryFunction(bot.address), bot[thresholdKey])) {
      if (!this.walletsAlerted[bot.address][thresholdKey]) {
        shouldPushBotNotification = true;
      }
      this.walletsAlerted[bot.address][thresholdKey] = true;
    } else {
      this.walletsAlerted[bot.address][thresholdKey] = false;
    }

    return shouldPushBotNotification;
  }

  _createLowBalanceMrkdwn = (bot, threshold, tokenBalance, tokenSymbol, tokenName) => {
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
  _ltThreshold(value, threshold) {
    // If the price has not resolved yet then return false.
    if (value == null) {
      return false;
    }
    return this.web3.utils.toBN(value).lt(this.web3.utils.toBN(threshold));
  }
}

module.exports = {
  BalanceMonitor
};
