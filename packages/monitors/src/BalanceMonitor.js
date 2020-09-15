// This module is used to monitor a list of addresses and their associated collateral, synthetic and ether balances.

const { createFormatFunction, createEtherscanLinkMarkdown, createObjectFromDefaultProps } = require("@uma/common");

class BalanceMonitor {
  /**
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} tokenBalanceClient Client used to query token balances for monitored bots and wallets.
   * @param tokenBalanceClient Instance of the TokenBalanceClient from the `financial-templates lib.
   * which provides synchronous access to address balances for a given expiring multi party contract.
   * @param {Object} config Object containing configuration for the balance monitor. Only option is a `botsToMonitor` 
   * which is defines an array of bot objects to monitor. Each bot's `botName` `address`, `CollateralThreshold`
   *      and`syntheticThreshold` must be given. Example:
   *      { botsToMonitor:[{ name: "Liquidator Bot",
   *         address: "0x12345"
   *         collateralThreshold: x1,
   *         syntheticThreshold: x2,
   *         etherThreshold: x3 },
   *      ..],
   *        logOverrides: {syntheticThreshold: "error", collateralThreshold: "error", ethThreshold: "error"}
   *      }
   * @param {Object} empProps Configuration object used to inform logs of key EMP information. Example:
   *      { collateralCurrencySymbol: "DAI",
            syntheticCurrencySymbol:"ETHBTC",
            priceIdentifier: "ETH/BTC",
            networkId:1 }
   */
  constructor({ logger, tokenBalanceClient, config, empProps }) {
    this.logger = logger;

    // Instance of the tokenBalanceClient to read account balances from last change update.
    this.client = tokenBalanceClient;
    this.web3 = this.client.web3;

    // Bot addresses and thresholds to monitor. If none provided then defaults to monitoring nothing. Configuration
    // object must conform to correct structure with the right key valued pairs.
    const defaultConfig = {
      botsToMonitor: {
        value: [],
        isValid: x => {
          // For the config to be valid it must be an array of objects with the right keys within the object as being
          // the `name`, `address`, `collateralThreshold`, `syntheticThreshold` and `etherThreshold`.
          return (
            Array.isArray(x) && // the value of `botsToMonitor` must be an array of objects.
            x.every(y => {
              // Each object within the array must have the following keys.
              return (
                Object.keys(y).includes("name") &&
                Object.keys(y).includes("address") &&
                this.web3.utils.isAddress(y.address) && // `address` must be a valid Ethereum address.
                Object.keys(y).includes("collateralThreshold") &&
                // Note this expects a string input as this should be a wei encoded version of the input number. If the
                // collateralThreshold was 5000 Dai this would be represented as 5000e18 or 5000000000000000000000 which
                // does not play well with JS as a number. As a result, these inputs should be strings.
                typeof y.collateralThreshold === "string" &&
                Object.keys(y).includes("syntheticThreshold") &&
                typeof y.syntheticThreshold === "string" &&
                Object.keys(y).includes("etherThreshold") &&
                typeof y.etherThreshold === "string"
              );
            })
          );
        }
      },
      logOverrides: {
        // Specify an override object to change default logging behaviour. Defaults to no overrides. If specified, this
        // object is structured to contain key for the log to override and value for the logging level. EG:
        // { syntheticThreshold:'error' } would override the default `warn` behaviour for synthetic-balance-threshold events.
        value: {},
        isValid: overrides => {
          // Override must be one of the default logging levels: ['error','warn','info','http','verbose','debug','silly']
          return Object.values(overrides).every(param => Object.keys(this.logger.levels).includes(param));
        }
      }
    };

    Object.assign(this, createObjectFromDefaultProps(config, defaultConfig));

    // Loop over all bots in the provided config and register them in the tokenBalanceClient. This will ensure that
    // the addresses are populated on the first fire of the clients `update` function enabling stateless execution.
    this.client.batchRegisterAddresses(this.botsToMonitor.map(bot => this.web3.utils.toChecksumAddress(bot.address)));

    // Contract constants including collateralCurrencySymbol, syntheticCurrencySymbol, priceIdentifier and networkId.
    this.empProps = empProps;

    this.formatDecimalStringCollateral = createFormatFunction(
      this.web3,
      2,
      4,
      false,
      this.empProps.collateralCurrencyDecimals
    );
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
        this.logger[this.logOverrides.collateralThreshold || "warn"]({
          at: "BalanceMonitor",
          message: "Low collateral balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwnCollateralCurrency(
            bot,
            bot.collateralThreshold,
            this.client.getCollateralBalance(monitoredAddress),
            this.empProps.collateralCurrencySymbol,
            "collateral",
            this.empProps.collateralCurrencyDecimals
          )
        });
      }
      if (this.toBN(this.client.getSyntheticBalance(monitoredAddress)).lt(this.toBN(bot.syntheticThreshold))) {
        this.logger[this.logOverrides.syntheticThreshold || "warn"]({
          at: "BalanceMonitor",
          message: "Low synthetic balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.syntheticThreshold,
            this.client.getSyntheticBalance(monitoredAddress),
            this.empProps.syntheticCurrencySymbol,
            "synthetic",
            this.empProps.syntheticCurrencyDecimals
          )
        });
      }
      if (this.toBN(this.client.getEtherBalance(monitoredAddress)).lt(this.toBN(bot.etherThreshold))) {
        this.logger[this.logOverrides.ethThreshold || "warn"]({
          at: "BalanceMonitor",
          message: "Low Ether balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.etherThreshold,
            this.client.getEtherBalance(monitoredAddress),
            "ETH",
            "ether",
            18
          )
        });
      }
    }
  }

  _createLowBalanceMrkdwn(bot, threshold, tokenBalance, tokenSymbol, tokenName) {
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
  }

  _createLowBalanceMrkdwnCollateralCurrency(bot, threshold, tokenBalance, tokenSymbol, tokenName) {
    return (
      bot.name +
      " (" +
      createEtherscanLinkMarkdown(bot.address, this.empProps.networkId) +
      ") " +
      tokenName +
      " balance is less than " +
      this.formatDecimalStringCollateral(threshold) +
      " " +
      tokenSymbol +
      ". Current balance is " +
      this.formatDecimalStringCollateral(tokenBalance) +
      " " +
      tokenSymbol
    );
  }
}

module.exports = {
  BalanceMonitor
};
