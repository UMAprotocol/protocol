const { createFormatFunction, createEtherscanLinkMarkdown } = require("../common/FormattingUtils");
const { createObjectFromDefaultProps } = require("../common/ObjectUtils");

class SyntheticPegMonitor {
  /**
   * @notice Constructs new Liquidator bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} uniswapPriceFeed Module used to query the current uniswap token price.
   * @param {Object} medianizerPriceFeed Module used to query the current crypto watch token price.
   * @param {Object} [config] Contains fields with which constructor will attempt to override defaults.
   */
  constructor(logger, uniswapPriceFeed, medianizerPriceFeed, config) {
    this.logger = logger;

    // Instance of price feeds used to check for deviation of synthetic token price.
    this.uniswapPriceFeed = uniswapPriceFeed;
    this.medianizerPriceFeed = medianizerPriceFeed;

    this.web3 = this.uniswapPriceFeed.web3;

    // Contract constants
    // TODO: replace this with an actual query to the collateral currency symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "UMATEST";

    // TODO: get the decimals of the collateral currency and use this to scale the output appropriately for non 1e18 colat
    this.formatDecimalString = createFormatFunction(this.web3, 2);

    // Default config settings. SyntheticPegMonitor deployer can override these settings by passing in new
    // values via the `config` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean.
    const { toBN, toWei } = this.web3.utils;
    const defaultConfig = {
      deviationAlertThreshold: {
        // `deviationAlertThreshold`: Error threshold used to compare observed and expected token prices.
        // if the deviation in token price exceeds this value an alert is fired.
        value: this.web3.utils.toBN(this.web3.utils.toWei("0.2")),
        isValid: x => {
          return toBN(x).lte(toBN(toWei("100"))) && toBN(x).gte(toBN("0"));
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
    const cryptoWatchTokenPrice = this.medianizerPriceFeed.getCurrentPrice();

    if (!uniswapTokenPrice || !cryptoWatchTokenPrice) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Cannot check for price deviation: price check error",
        uniswapTokenPrice: uniswapTokenPrice,
        cryptoWatchTokenPrice: cryptoWatchTokenPrice
      });
      return;
    }
    const deviationError = this._calculateDeviationError(uniswapTokenPrice, cryptoWatchTokenPrice);
    // If the percentage error is greater than (gt) the threshold send a message.
    if (deviationError.gt(this.deviationAlertThreshold)) {
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
          this.formatDecimalString(deviationError.muln(100)) + // multiply by 100 to make the error a percentage
          "%."
      });
    }
  };

  // Takes in two big numbers and returns the error between them.
  // calculated using: δ = | (observed - expected) / expected |
  // For example an observed price of 1.25 with an expected price of 1.0 will return | (1.2 - 1.0) / 1.0 | = 0.20
  // This is equivalent of a 20 percent absolute deviation between the numbers.
  _calculateDeviationError(observedValue, expectedValue) {
    return observedValue
      .sub(expectedValue)
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1"))) // Scale the numerator before division
      .div(expectedValue)
      .abs();
  }
}

module.exports = {
  SyntheticPegMonitor
};
