// This module is used to monitor a list of addresses and their associated collateral, synthetic and ether balances.

const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");

class BalanceMonitor {
  /**
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} tokenBalanceClient Client used to query token balances for monitored bots and wallets.
   * @param tokenBalanceClient Instance of the TokenBalanceClient from the `financial-templates lib.
   * which provides synchronous access to address balances for a given expiring multi party contract.
   * @param {List} botsToMonitor Array of bot objects to monitor. Each bot's `botName` `address`, `CollateralThreshold`
   *      and`syntheticThreshold` must be given. Example:
   *      [{ name: "Liquidator Bot",
   *         address: "0x12345"
   *         collateralThreshold: x1,
   *         syntheticThreshold: x2,
   *         etherThreshold: x3 },
   *      ..]
   * @param {Object} empProps Configuration object used to inform logs of key EMP information. Example:
   *      { collateralCurrencySymbol: "DAI",
            syntheticCurrencySymbol:"ETHBTC",
            priceIdentifier: "ETH/BTC",
            networkId:1 }
   */
  constructor(logger, tokenBalanceClient, botsToMonitor, empProps) {
    this.logger = logger;

    // Instance of the tokenBalanceClient to read account balances from last change update.
    this.client = tokenBalanceClient;
    this.web3 = this.client.web3;

    // Bot addresses and thresholds to monitor.
    this.botsToMonitor = botsToMonitor;

    // Loop over all bots in the provided config and register them in the tokenBalanceClient. This will ensure that
    // the addresses are populated on the first fire of the clients `update` function enabling stateless execution.
    this.client.batchRegisterAddresses(this.botsToMonitor.map(bot => this.web3.utils.toChecksumAddress(bot.address)));

    // Contract constants including collateralCurrencySymbol, syntheticCurrencySymbol, priceIdentifier and networkId.
    this.empProps = empProps;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
  }

  // Queries all bot ballance for collateral, synthetic and ether against specified thresholds.
  async checkBotBalances() {
    this.logger.debug({
      at: "BalanceMonitor",
      message: "Checking bot balances"
    });

    // Loop over all the bot objects specified to monitor in the this.botsToMonitor object and for each bot
    // check if their collateral, synthetic or ether balance is below a given threshold. If it is, then
    // send a winston event. The message structure is defined with the `_createLowBalanceMrkdwn` formatter.
    for (let bot of this.botsToMonitor) {
      const monitoredAddress = this.web3.utils.toChecksumAddress(bot.address);

      if (this.toBN(this.client.getCollateralBalance(monitoredAddress)).lt(this.toBN(bot.collateralThreshold))) {
        this.logger.warn({
          at: "BalanceMonitor",
          message: "Low collateral balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.collateralThreshold,
            this.client.getCollateralBalance(monitoredAddress),
            this.empProps.collateralCurrencySymbol,
            "collateral"
          )
        });
      }
      if (this.toBN(this.client.getSyntheticBalance(monitoredAddress)).lt(this.toBN(bot.syntheticThreshold))) {
        this.logger.warn({
          at: "BalanceMonitor",
          message: "Low synthetic balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.syntheticThreshold,
            this.client.getSyntheticBalance(monitoredAddress),
            this.empProps.syntheticCurrencySymbol,
            "synthetic"
          )
        });
      }
      if (this.toBN(this.client.getEtherBalance(monitoredAddress)).lt(this.toBN(bot.etherThreshold))) {
        this.logger.warn({
          at: "BalanceMonitor",
          message: "Low Ether balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.etherThreshold,
            this.client.getEtherBalance(monitoredAddress),
            "ETH",
            "ether"
          )
        });
      }
    }
  }

  _createLowBalanceMrkdwn(bot, threshold, tokenBalance, tokenSymbol, tokenName) {
    return (
      bot.name +
      " (" +
      createEtherscanLinkMarkdown(monitoredAddress, this.empProps.networkId) +
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
  }
}

module.exports = {
  BalanceMonitor
};
