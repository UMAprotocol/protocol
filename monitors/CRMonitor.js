const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");

// This module is used to monitor a list of addresses and their associated Collateralization ratio.
class CRMonitor {
  /**
   * @notice Constructs new Collateral Requirement Monitor.
   * @param {Object} logger an instance of a winston logger used to emit messages, logs and errors.
   * @param {Object} expiringMultiPartyClient an instance of the expiringMultiPartyClient from the `financial-templates
   *                 lib which provides synchronous access to positions opened against an expiring multiparty
   * @param {Object} walletsToMonitor array of wallets to Monitor. Each wallet's `walletName`, `address`, `crAlert`
   *                 must be given:
   *                 [{ name: "Market Making bot",
   *                    address: "0x12345",
   *                    crAlert: 1.50 }, // Note 150% is represented as 1.5
   *                  ...];
   * @param {Object} priceFeed offchain price feed used to track the token price.
   */
  constructor(logger, expiringMultiPartyClient, walletsToMonitor, priceFeed) {
    this.logger = logger;

    this.empClient = expiringMultiPartyClient;
    this.web3 = this.empClient.web3;

    // Offchain price feed to compute the current collateralization ratio for the monitored positions.
    this.priceFeed = priceFeed;

    // Wallet addresses and thresholds to monitor.
    this.walletsToMonitor = walletsToMonitor;

    this.formatDecimalString = createFormatFunction(this.web3, 2, 4);

    // TODO: replace this with a fetcher that pulls the actual collateral token symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "ETHBTC";
  }

  // Queries all monitored wallet ballance for collateralization ratio against a given threshold.
  async checkWalletCrRatio() {
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
      const positionInformation = this._getPositionInformation(wallet.address);
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
      if (this._ltThreshold(positionCR, this.web3.utils.toWei(wallet.crAlert.toString()))) {
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
          createEtherscanLinkMarkdown(this.web3, wallet.address) +
          ") collateralization ratio has dropped to " +
          this.formatDecimalString(positionCR.muln(100)) + // Scale up the CR threshold by 100 to become a percentage
          "% which is below the " +
          wallet.crAlert * 100 +
          "% threshold. Current value of " +
          this.syntheticCurrencySymbol +
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
    return this.empClient.getAllPositions().find(position => position.sponsor == address);
  }

  // Checks if a big number value is below a given threshold.
  _ltThreshold(value, threshold) {
    const { toBN, toWei } = this.web3.utils;
    // If the price has not resolved yet then return false.
    if (value == null) {
      return false;
    }
    return toBN(value).lt(toBN(threshold));
  }

  // Calculate the collateralization Ratio from the collateral, token amount and token price
  // This is cr = collateral / (tokensOutstanding * price)
  _calculatePositionCRPercent(collateral, tokensOutstanding, tokenPrice) {
    const { toBN, toWei } = this.web3.utils;
    if (collateral == 0) {
      return 0;
    }
    if (tokensOutstanding == 0) {
      return null;
    }
    return toBN(collateral)
      .mul(toBN(toWei("1")))
      .mul(toBN(toWei("1")))
      .div(toBN(tokensOutstanding).mul(toBN(tokenPrice)));
  }

  _calculatePriceForCR(collateral, tokensOutstanding, positionCR) {
    const { toBN, toWei } = this.web3.utils;
    const fixedPointScaling = toBN(toWei("1"));
    return toBN(collateral)
      .mul(fixedPointScaling)
      .mul(fixedPointScaling)
      .div(toBN(tokensOutstanding))
      .div(toBN(positionCR));
  }
}

module.exports = {
  CRMonitor
};
