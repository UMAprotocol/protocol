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
  constructor(logger, tokenBalanceClient, botsToMonitor, empProps) {
    this.logger = logger;

    // Instance of the tokenBalanceClient to read account balances from last change update.
    this.client = tokenBalanceClient;
    this.web3 = this.client.web3;

    // Bot addresses and thresholds to monitor.
    this.botsToMonitor = botsToMonitor;

    // Contract constants including collateralCurrencySymbol, syntheticCurrencySymbol, priceIdentifier and networkId.
    this.empProps = empProps;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
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
      if (this._ltThreshold(this.client.getCollateralBalance(bot.address), bot.collateralThreshold)) {
        this.logger.warn({
          at: "BalanceMonitor",
          message: "Low collateral balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.collateralThreshold,
            this.client.getCollateralBalance(bot.address),
            this.empProps.collateralCurrencySymbol,
            "collateral"
          )
        });
      }
      if (this._ltThreshold(this.client.getSyntheticBalance(bot.address), bot.syntheticThreshold)) {
        this.logger.warn({
          at: "BalanceMonitor",
          message: "Low synthetic balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.syntheticThreshold,
            this.client.getSyntheticBalance(bot.address),
            this.empProps.syntheticCurrencySymbol,
            "synthetic"
          )
        });
      }
      if (this._ltThreshold(this.client.getEtherBalance(bot.address), bot.etherThreshold)) {
        this.logger.warn({
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

  _createLowBalanceMrkdwn = (bot, threshold, tokenBalance, tokenSymbol, tokenName) => {
    return (
      bot.name +
      " (" +
      createEtherscanLinkMarkdown(bot.address, this.empProps.networkId) +
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
    return this.toBN(value).lt(this.toBN(threshold));
  }
}

module.exports = {
  BalanceMonitor
};
