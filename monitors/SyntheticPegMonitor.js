const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");
const { createObjectFromDefaultProps } = require("../common/ObjectUtils");

class SyntheticPegMonitor {
  /**
   * @notice Constructs new Liquidator bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} uniswapPriceFeed Module used to query the current uniswap token price.
   * @param {Object} cryptoWatchPriceFeed Module used to query the current crypto watch token price.
   * @param {Object} [config] Contains fields with which constructor will attempt to override defaults.
   */
  constructor(logger, uniswapPriceFeed, cryptoWatchPriceFeed, config) {
    this.logger = logger;

    // Instance of price feeds used to check for deviation of synthetic token price.
    this.uniswapPriceFeed = uniswapPriceFeed;
    this.cryptoWatchPriceFeed = cryptoWatchPriceFeed;

    this.web3 = this.uniswapPriceFeed.web3;

    // Contract constants
    // TODO: replace this with an actual query to the collateral currency symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "UMATEST";

    // TODO: get the decimals of the collateral currency and use this to scale the output appropriately for non 1e18 colat
    this.formatDecimalString = createFormatFunction(this.web3, 2);

    // If the price of one price feed deviates by more than `deviationAlertThreshold` percent from the other, trigger alert.
    this.deviationAlertThreshold = this.web3.utils.toBN(this.web3.utils.toWei("20"));

    // Default config settings. SyntheticPegMonitor deployer can override these settings by passing in new
    // values via the `config` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean.
    const defaultConfig = {
      deviationAlertThreshold: {
        // `deviationAlertThreshold`: Percentage error threshold used to compare observed and expected token prices.
        // if the deviation in token price exceeds this value an alert is fired.
        value: 20,
        isValid: x => {
          return x >= 0 && x < 100;
        }
      }
    };
    Object.assign(this, createObjectFromDefaultProps(config, defaultConfig));
  }

  // Queries disputable liquidations and disputes any that were incorrectly liquidated.
  checkPriceDeviation = async () => {
    this.logger.debug({
      at: "SyntheticPegMonitor",
      message: "Checking price deviation"
    });
    // Get the latest prices from the two price feeds.
    const uniswapTokenPrice = this.uniswapPriceFeed.getLastBlockPrice();
    const cryptoWatchTokenPrice = this.cryptoWatchPriceFeed.getCurrentPrice();

    if (!uniswapTokenPrice || !cryptoWatchTokenPrice) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Cannot check for price deviation: price check error",
        uniswapTokenPrice: uniswapTokenPrice,
        cryptoWatchTokenPrice: cryptoWatchTokenPrice
      });
      return;
    }
    const percentageError = this._calculatePercentageError(uniswapTokenPrice, cryptoWatchTokenPrice);
    // If the percentage error is greater than (gt) the threshold send a message.
    if (percentageError.gt(this.deviationAlertThreshold)) {
      this.logger.error({
        at: "SyntheticPegMonitor",
        message: "Synthetic off peg alert 😵",
        mrkdwn:
          "Synthetic token " +
          this.syntheticCurrencySymbol +
          " is trading at " +
          this.formatDecimalString(uniswapTokenPrice) +
          " on Uniswap. Target price is " +
          this.formatDecimalString(cryptoWatchTokenPrice) +
          ". Error of " +
          this.formatDecimalString(percentageError) +
          "%."
      });
    }
  };

  // Takes in two big numbers and returns the percentage error between them.
  // calculated using: δ = | (observed - expected) / expected | * 100
  // For example an observed price of 1.25 with an expected price of 1.15 will return | (1.2 - 1.0) / 1.0 | * 100 = 20%
  _calculatePercentageError(observedValue, expectedValue) {
    return observedValue
      .sub(expectedValue)
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1"))) // Scale the numerator before division
      .div(expectedValue)
      .abs()
      .muln(100); // scale for percentage
  }
}

module.exports = {
  SyntheticPegMonitor
};
