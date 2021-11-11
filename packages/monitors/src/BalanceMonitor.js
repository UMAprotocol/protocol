// This module is used to monitor a list of addresses and their associated collateral, synthetic and ether balances.

const {
  ConvertDecimals,
  createFormatFunction,
  createEtherscanLinkMarkdown,
  createObjectFromDefaultProps,
} = require("@uma/common");

class BalanceMonitor {
  /**
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} tokenBalanceClient Client used to query token balances for monitored bots and wallets.
   * @param tokenBalanceClient Instance of the TokenBalanceClient from the `financial-templates lib.
   * which provides synchronous access to address balances for a given Financial Contract contract.
   * @param {Object} monitorConfig Object containing configuration for the balance monitor. Only option is a `botsToMonitor` 
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
   * @param {Object} financialContractProps Configuration object used to inform logs of key Financial Contract information. Example:
   *      { collateralSymbol: "DAI",
            syntheticSymbol:"ETHBTC",
            collateralDecimals: 18,
            syntheticDecimals: 18,
            networkId:1 }
   */
  constructor({ logger, tokenBalanceClient, monitorConfig, financialContractProps }) {
    this.logger = logger;

    // Instance of the tokenBalanceClient to read account balances from last change update.
    this.client = tokenBalanceClient;
    this.web3 = this.client.web3;

    // Bot addresses and thresholds to monitor. If none provided then defaults to monitoring nothing. Configuration
    // object must conform to correct structure with the right key valued pairs.
    const defaultConfig = {
      botsToMonitor: {
        value: [],
        isValid: (x) => {
          // For the config to be valid it must be an array of objects with the right keys within the object as being
          // the `name`, `address`, `collateralThreshold`, `syntheticThreshold` and `etherThreshold`.
          return (
            Array.isArray(x) && // the value of `botsToMonitor` must be an array of objects.
            x.every((y) => {
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
        },
      },
      logOverrides: {
        // Specify an override object to change default logging behaviour. Defaults to no overrides. If specified, this
        // object is structured to contain key for the log to override and value for the logging level. EG:
        // { syntheticThreshold:'error' } would override the default `warn` behaviour for synthetic-balance-threshold events.
        value: {},
        isValid: (overrides) => {
          // Override must be one of the default logging levels: ['error','warn','info','http','verbose','debug','silly']
          return Object.values(overrides).every((param) => Object.keys(this.logger.levels).includes(param));
        },
      },
    };

    Object.assign(this, createObjectFromDefaultProps(monitorConfig, defaultConfig));

    // Loop over all bots in the provided monitorConfig and register them in the tokenBalanceClient. This will ensure that
    // the addresses are populated on the first fire of the clients `update` function enabling stateless execution.
    this.client.batchRegisterAddresses(this.botsToMonitor.map((bot) => this.web3.utils.toChecksumAddress(bot.address)));

    // Validate the financialContractProps object. This contains a set of important info within it so need to be sure it's structured correctly.
    const defaultFinancialContractProps = {
      financialContractProps: {
        value: {},
        isValid: (x) => {
          // The config must contain the following keys and types:
          return (
            Object.keys(x).includes("collateralSymbol") &&
            typeof x.collateralSymbol === "string" &&
            Object.keys(x).includes("syntheticSymbol") &&
            typeof x.syntheticSymbol === "string" &&
            Object.keys(x).includes("collateralDecimals") &&
            typeof x.collateralDecimals === "number" &&
            Object.keys(x).includes("syntheticDecimals") &&
            typeof x.syntheticDecimals === "number" &&
            Object.keys(x).includes("networkId") &&
            typeof x.networkId === "number"
          );
        },
      },
    };
    Object.assign(this, createObjectFromDefaultProps({ financialContractProps }, defaultFinancialContractProps));

    this.normalizeCollateralDecimals = ConvertDecimals(financialContractProps.collateralDecimals, 18, this.web3);
    this.normalizeSyntheticDecimals = ConvertDecimals(financialContractProps.syntheticDecimals, 18, this.web3);

    // Formats an 18 decimal point string with a define number of decimals and precision for use in message generation.
    this.formatDecimalString = createFormatFunction(2, 4, false);

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
  }

  // Queries all bot balance for collateral, synthetic and ether against specified thresholds.
  async checkBotBalances() {
    this.logger.debug({ at: "BalanceMonitor", message: "Checking bot balances" });

    // Loop over all the bot objects specified to monitor in the this.botsToMonitor object and for each bot
    // check if their collateral, synthetic or ether balance is below a given threshold. If it is, then
    // send a winston event. The message structure is defined with the `_createLowBalanceMrkdwn` formatter.
    for (let bot of this.botsToMonitor) {
      const monitoredAddress = this.web3.utils.toChecksumAddress(bot.address);

      if (this.toBN(this.client.getCollateralBalance(monitoredAddress)).lt(this.toBN(bot.collateralThreshold))) {
        this.logger[this.logOverrides.collateralThreshold || "warn"]({
          at: "BalanceMonitor",
          message: "Low collateral balance warning ⚠️",
          mrkdwn: this._createLowBalanceMrkdwn(
            bot,
            bot.collateralThreshold,
            this.client.getCollateralBalance(monitoredAddress),
            this.financialContractProps.collateralSymbol,
            "collateral",
            this.normalizeCollateralDecimals
          ),
          notificationPath: "risk-management",
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
            this.financialContractProps.syntheticSymbol,
            "synthetic",
            this.normalizeSyntheticDecimals
          ),
          notificationPath: "risk-management",
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
            (num) => this.toBN(num)
          ),
          notificationPath: "risk-management",
        });
      }
    }
  }

  _createLowBalanceMrkdwn(bot, threshold, tokenBalance, tokenSymbol, tokenName, normalizationFunction) {
    return (
      bot.name +
      " (" +
      createEtherscanLinkMarkdown(bot.address, this.financialContractProps.networkId) +
      ") " +
      tokenName +
      " balance is less than " +
      this.formatDecimalString(normalizationFunction(threshold)) +
      " " +
      tokenSymbol +
      ". Current balance is " +
      this.formatDecimalString(normalizationFunction(tokenBalance)) +
      " " +
      tokenSymbol
    );
  }
}

module.exports = { BalanceMonitor };
