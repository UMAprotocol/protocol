// This module is used to monitor a list of addresses and their associated Collateralization ratio.

const {
  ConvertDecimals,
  createFormatFunction,
  createEtherscanLinkMarkdown,
  createObjectFromDefaultProps
} = require("@uma/common");

class CRMonitor {
  /**
   * @notice Constructs new Collateral Requirement Monitor.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} expiringMultiPartyClient Client used to query EMP status for monitored wallets position info.
   * @param {Object} priceFeed Module used to query the current token price.
   * @param {Object} config Object containing an array of wallets to Monitor. Each wallet's `walletName`, `address`,
   * `crAlert` must be given. Example:
   *      { walletsToMonitor: [{ name: "Market Making bot", // Friendly bot name
   *            address: "0x12345",                         // Bot address
   *            crAlert: 1.50 },                            // CR alerting threshold to generate an alert message; 1.5=150%
   *       ...],
   *        logLevelOverrides: {crThreshold: "error"}       // Log level overrides
   *      };
   * @param {Object} empProps Configuration object used to inform logs of key EMP information. Example:
   *      { collateralCurrencySymbol: "DAI",
            syntheticCurrencySymbol:"ETHBTC",
            collateralCurrencyDecimals: 18,
            syntheticCurrencyDecimals: 18,
            priceIdentifier: "ETH/BTC",
            networkId:1 }
   */
  constructor({ logger, expiringMultiPartyClient, priceFeed, config, empProps }) {
    this.logger = logger;

    this.empClient = expiringMultiPartyClient;
    this.web3 = this.empClient.web3;

    // Offchain price feed to compute the current collateralization ratio for the monitored positions.
    this.priceFeed = priceFeed;

    // Contract constants including collateralCurrencySymbol, syntheticCurrencySymbol, priceIdentifier and networkId.
    this.empProps = empProps;

    this.convertCollateralToSynthetic = ConvertDecimals(
      empProps.collateralCurrencyDecimals,
      empProps.syntheticCurrencyDecimals,
      this.web3
    );

    this.formatDecimalStringCollateral = createFormatFunction(
      this.web3,
      2,
      4,
      false,
      empProps.collateralCurrencyDecimals
    );
    this.formatDecimalString = createFormatFunction(this.web3, 2, 4, false);

    // Wallets to monitor collateralization ratio.
    const defaultConfig = {
      // By default monitor no wallets for correct collateralization ratio.
      walletsToMonitor: {
        value: [],
        isValid: x => {
          return (
            Array.isArray(x) && // the value of `walletsToMonitor` must be an array of objects.
            x.every(y => {
              // Each object within the array must have the following keys.
              return (
                Object.keys(y).includes("name") &&
                typeof y.name === "string" &&
                Object.keys(y).includes("address") &&
                this.web3.utils.isAddress(y.address) && // `address` must be a valid Ethereum address.
                Object.keys(y).includes("crAlert") &&
                typeof y.crAlert === "number"
              );
            })
          );
        }
      },
      logOverrides: {
        // Specify an override object to change default logging behaviour. Defaults to no overrides. If specified, this
        // object is structured to contain key for the log to override and value for the logging level. EG:
        // { crThreshold:'error' } would override the default `warn` behaviour for CR threshold events.
        value: {},
        isValid: overrides => {
          // Override must be one of the default logging levels: ['error','warn','info','http','verbose','debug','silly']
          return Object.values(overrides).every(param => Object.keys(this.logger.levels).includes(param));
        }
      }
    };

    Object.assign(this, createObjectFromDefaultProps(config, defaultConfig));

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
  }

  // Queries all monitored wallet ballance for collateralization ratio against a given threshold.
  async checkWalletCrRatio() {
    if (this.walletsToMonitor.length == 0) return; // If there are no wallets to monitor exit early
    // yield the price feed at the current time.
    const price = this.priceFeed.getCurrentPrice();

    if (!price) {
      this.logger.warn({
        at: "CRMonitor",
        message: "Cannot compute wallet collateralization ratio because price feed returned invalid value"
      });
      return;
    }

    this.logger.debug({
      at: "CRMonitor",
      message: "Checking wallet collateralization ratios",
      price: price.toString()
    });
    // For each monitored wallet check if the current collaterlization ratio is below the monitored threshold.
    // If it is, then send an alert of formatted markdown text.
    for (let wallet of this.walletsToMonitor) {
      const monitoredAddress = this.web3.utils.toChecksumAddress(wallet.address);

      const positionInformation = this._getPositionInformation(monitoredAddress);
      if (positionInformation == null) {
        // There is no position information for the given wallet. Next run this will be updated as it is now enqueued.
        continue;
      }

      const collateral = positionInformation.amountCollateral;
      const withdrawalRequestAmount = positionInformation.withdrawalRequestAmount;
      const tokensOutstanding = positionInformation.numTokens;

      // If the values for collateral or price have yet to resolve, dont push a notification.
      if (collateral == null || tokensOutstanding == null) {
        continue;
      }

      // Subtract requested withdrawal amount from position
      const backingCollateral = this.toBN(collateral)
        .sub(this.toBN(withdrawalRequestAmount))
        .toString();

      // If CR = null then there are no tokens outstanding and so dont push a notification.
      const positionCR = this._calculatePositionCRPercent(backingCollateral, tokensOutstanding, price);
      if (positionCR == null) {
        continue;
      }

      // Lastly, if we have gotten a position CR ratio this can be compared against the threshold. If it is below the
      // threshold then push the notification.
      if (this._ltThreshold(positionCR, this.toWei(wallet.crAlert.toString()))) {
        const liquidationPrice = this._calculatePriceForCR(
          backingCollateral,
          tokensOutstanding,
          this.empClient.collateralRequirement
        );

        // Sample message:
        // Risk alert: [Tracked wallet name] has fallen below [threshold]%.
        // Current [name of identifier] value: [current identifier value].
        const mrkdwn =
          wallet.name +
          " (" +
          createEtherscanLinkMarkdown(monitoredAddress, this.empProps.networkId) +
          ") collateralization ratio has dropped to " +
          this.formatDecimalString(positionCR.muln(100)) + // Scale up the CR threshold by 100 to become a percentage
          "% which is below the " +
          wallet.crAlert * 100 +
          "% threshold. Current value of " +
          this.empProps.syntheticCurrencySymbol +
          " is " +
          this.formatDecimalString(price) +
          ". The collateralization requirement is " +
          this.formatDecimalString(this.empClient.collateralRequirement.muln(100)) +
          "%. Liquidation price: " +
          this.formatDecimalString(liquidationPrice) +
          ".";

        this.logger[this.logOverrides.crThreshold || "warn"]({
          at: "CRMonitor",
          message: "Collateralization ratio alert 🙅‍♂️!",
          mrkdwn: mrkdwn
        });
      }
    }
  }

  _getPositionInformation(address) {
    return this.empClient.getAllPositions().find(position => position.sponsor === address);
  }

  // Checks if a big number value is below a given threshold.
  _ltThreshold(value, threshold) {
    // If the price has not resolved yet then return false.
    if (value == null) {
      return false;
    }
    return this.toBN(value).lt(this.toBN(threshold));
  }

  // Calculate the collateralization Ratio from the collateral, token amount and token price
  // This is cr = (collateral-withdrawalRequestAmount) / (tokensOutstanding * price)
  _calculatePositionCRPercent(collateral, tokensOutstanding, tokenPrice) {
    if (collateral == 0) {
      return 0;
    }
    if (tokensOutstanding == 0) {
      return null;
    }
    return this.toBN(this.convertCollateralToSynthetic(collateral))
      .mul(this.toBN(this.toWei("1")))
      .mul(this.toBN(this.toWei("1")))
      .div(this.toBN(tokensOutstanding).mul(this.toBN(tokenPrice)));
  }

  _calculatePriceForCR(collateral, tokensOutstanding, positionCR) {
    return this.toBN(this.convertCollateralToSynthetic(collateral))
      .mul(this.toBN(this.toWei("1")))
      .mul(this.toBN(this.toWei("1")))
      .div(this.toBN(tokensOutstanding))
      .div(this.toBN(positionCR));
  }
}

module.exports = {
  CRMonitor
};
