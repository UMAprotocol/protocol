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
   *                    crAlert: 150 },
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

    this.formatDecimalString = createFormatFunction(this.web3, 2);

    // TODO: replace this with a fetcher that pulls the actual collateral token symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "ETHBTC";
  }

  // Queries all monitored wallet ballance for collateralization ratio against a given threshold.
  checkWalletCrRatio = async () => {
    // yield the price feed at the current time.
    const price = this.priceFeed.getCurrentPrice();

    if (!price) {
      this.logger.warn({
        at: "CRMonitor",
        message: "Cannot compute wallet collateralization ratio because price feed returned invalid value",
        price: price.toString()
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
        // Sample message:
        // Risk alert: [Tracked wallet name] has fallen below [threshold]%.
        // Current [name of identifier] value: [current identifier value].
        const mrkdwn =
          wallet.name +
          " (" +
          createEtherscanLinkMarkdown(this.web3, wallet.address) +
          ") collateralization ratio has dropped to " +
          this.formatDecimalString(positionCR) +
          "% which is below the " +
          wallet.crAlert +
          "% threshold. Current value of " +
          this.syntheticCurrencySymbol +
          " is " +
          this.formatDecimalString(price);

        this.logger.warn({
          at: "ContractMonitor",
          message: "Collateralization ratio alert 🙅‍♂️!",
          mrkdwn: mrkdwn
        });
      }
    }
  };

  _getPositionInformation = address => {
    const positionInfo = this.empClient.getAllPositions().filter(position => position.sponsor == address);
    if (positionInfo.length == 0) {
      return null;
      // there should only ever be one position information object per address
    } else return positionInfo[0];
  };

  // Checks if a big number value is below a given threshold.
  _ltThreshold(value, threshold) {
    // If the price has not resolved yet then return false.
    if (value == null) {
      return false;
    }
    return this.web3.utils.toBN(value).lt(this.web3.utils.toBN(threshold));
  }

  // TODO: refactor this out into a separate utility function
  // Calculate the collateralization Ratio from the collateral, token amount and token price
  // This is cr = [collateral / (tokensOutstanding * price)] * 100
  _calculatePositionCRPercent = (collateral, tokensOutstanding, tokenPrice) => {
    if (collateral == 0) {
      return 0;
    }
    if (tokensOutstanding == 0) {
      return null;
    }
    return this.web3.utils
      .toBN(collateral)
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1")))
      .div(this.web3.utils.toBN(tokensOutstanding).mul(this.web3.utils.toBN(tokenPrice)))
      .muln(100)
      .toString();
  };
}

module.exports = {
  CRMonitor
};
