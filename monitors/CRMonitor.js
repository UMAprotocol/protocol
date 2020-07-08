// This module is used to monitor a list of addresses and their associated Collateralization ratio.

const {
  createFormatFunction,
  createEtherscanLinkMarkdown,
  createObjectFromDefaultProps
} = require("@umaprotocol/common");

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
   *       ...] };
   * @param {Object} empProps Configuration object used to inform logs of key EMP information. Example:
   *      { collateralCurrencySymbol: "DAI",
            syntheticCurrencySymbol:"ETHBTC",
            priceIdentifier: "ETH/BTC",
            networkId:1 }
   */
  constructor(logger, expiringMultiPartyClient, priceFeed, config, empProps) {
    this.logger = logger;

    this.empClient = expiringMultiPartyClient;
    this.web3 = this.empClient.web3;

    // Offchain price feed to compute the current collateralization ratio for the monitored positions.
    this.priceFeed = priceFeed;

    // Contract constants including collateralCurrencySymbol, syntheticCurrencySymbol, priceIdentifier and networkId.
    this.empProps = empProps;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);

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
      const tokensOutstanding = positionInformation.numTokens;

      // If the values for collateral or price have yet to resolve, dont push a notification.
      if (collateral == null || tokensOutstanding == null) {
        continue;
      }

      // If CR = null then there are no tokens outstanding and so dont push a notification.
      const positionCR = this._calculatePositionCRPercent(collateral, tokensOutstanding, price);
      if (positionCR == null) {
        continue;
      }

      // Lastly, if we have gotten a position CR ratio this can be compared against the threshold. If it is below the
      // threshold then push the notification.
      if (this._ltThreshold(positionCR, this.toWei(wallet.crAlert.toString()))) {
        const liquidationPrice = this._calculatePriceForCR(
          collateral,
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
          "%. If the price increases to " +
          this.formatDecimalString(liquidationPrice) +
          ", the position can be liquidated.";

        this.logger.warn({
          at: "ContractMonitor",
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
  // This is cr = collateral / (tokensOutstanding * price)
  _calculatePositionCRPercent(collateral, tokensOutstanding, tokenPrice) {
    if (collateral == 0) {
      return 0;
    }
    if (tokensOutstanding == 0) {
      return null;
    }
    return this.toBN(collateral)
      .mul(this.toBN(this.toWei("1")))
      .mul(this.toBN(this.toWei("1")))
      .div(this.toBN(tokensOutstanding).mul(this.toBN(tokenPrice)));
  }

  _calculatePriceForCR(collateral, tokensOutstanding, positionCR) {
    const fixedPointScaling = this.toBN(this.toWei("1"));
    return this.toBN(collateral)
      .mul(fixedPointScaling)
      .mul(fixedPointScaling)
      .div(this.toBN(tokensOutstanding))
      .div(this.toBN(positionCR));
  }
}

module.exports = {
  CRMonitor
};
