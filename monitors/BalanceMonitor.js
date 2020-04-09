const { Logger } = require("../financial-templates-lib/logger/Logger");

const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");
const networkUtils = require("../common/PublicNetworks");

const { calculatePositionCRPercent } = require("./utils/PositionCRCalculator");

class BalanceMonitor {
  constructor(balanceMonitorClient, account, botsToMonitor, walletsToMonitor) {
    this.account = account;

    // An array of bot objects to monitor. Each bot's `botName` `address`,
    // `CollateralThreshold` and`syntheticThreshold` must be given. Example:
    // [{ botName: "Liquidator Bot",
    //   address: '0x12345'
    //   collateralThreshold: x1,
    //   syntheticThreshold: x2,
    //   etherThreshold: x3 },
    // ...]
    this.botsToMonitor = botsToMonitor;

    // An array of wallets to Monitor. Each wallet's `walletName`, `address`, `crAlert`
    // must be given. Example:
    // [{ walletName: "Market Making bot",
    //    address: '0x12345',
    //    crAlert: 150},
    // ...];
    this.walletsToMonitor = walletsToMonitor;

    // Instance of the balanceMonitorClient to read account balances from last change update.
    this.client = balanceMonitorClient;

    this.web3 = this.client.web3;

    this.formatDecimalString = createFormatFunction(this.web3, 2);

    //TODO: replace this with a fetcher that pulls the actual collateral token symbol
    // need to decide where this logic goes.
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "UMATEST";
  }

  ltThreshold(balance, threshold) {
    console.log("comapring balance & throedhold as", balance.toString(), threshold.toString());
    return this.web3.utils.toBN(balance).lt(this.web3.utils.toBN(threshold));
  }

  // Queries disputable liquidations and disputes any that were incorrectly liquidated.
  checkBotBalances = async () => {
    Logger.debug({
      at: "BalanceMonitor",
      message: "Checking for Balances"
    });

    for (let bot of this.botsToMonitor) {
      if (this.ltThreshold(this.client.getCollateralBalance(bot.address), bot.collateralThreshold)) {
        Logger.info({
          at: "BalanceMonitor",
          message: "Low collateral balance warning ⚠️",
          mrkdwn: this.createLowBalanceMrkdwn(
            bot,
            bot.collateralThreshold,
            this.client.getCollateralBalance(bot.address),
            this.collateralCurrencySymbol
          )
        });
      }
      if (this.ltThreshold(this.client.getSyntheticBalance(bot.address), bot.syntheticThreshold)) {
        Logger.info({
          at: "BalanceMonitor",
          message: "Low synthetic balance warning ⚠️",
          mrkdwn: this.createLowBalanceMrkdwn(
            bot,
            bot.syntheticThreshold,
            this.client.getSyntheticBalance(bot.address),
            this.syntheticCurrencySymbol
          )
        });
      }
      if (this.ltThreshold(this.client.getEtherBalance(bot.address), bot.etherThreshold)) {
        console.log("below threshold for ether");
        Logger.info({
          at: "BalanceMonitor",
          message: "Low Ether balance warning ⚠️",
          mrkdwn: this.createLowBalanceMrkdwn(bot, bot.etherThreshold, this.client.getEtherBalance(bot.address), "ETH")
        });
      }
    }
  };

  createLowBalanceMrkdwn = (bot, threshold, tokenBalance, tokenSymbol) => {
    return (
      bot.name +
      " (" +
      createEtherscanLinkMarkdown(this.web3, networkUtils, bot.address) +
      ") " +
      tokenSymbol +
      " token balance is less than " +
      this.formatDecimalString(threshold) +
      " " +
      tokenSymbol +
      ". Current balance is " +
      this.formatDecimalString(tokenBalance) +
      " " +
      tokenSymbol
    );
  };
}

module.exports = {
  BalanceMonitor
};
