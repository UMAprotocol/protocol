const { createFormatFunction, formatHours } = require("../common/FormattingUtils");
const { createObjectFromDefaultProps } = require("../common/ObjectUtils");

class SyntheticPegMonitor {
  /**
   * @notice Constructs new Liquidator bot.
   * @param {Object} logger Module used to send logs.
   * @param {Object} web3 Instance of a web3 client provided by the class that initiates the monitor module.
   * @param {Object} uniswapPriceFeed Module used to query the current uniswap token price.
   * @param {Object} medianizerPriceFeed Module used to query the median price among selected price feeds.
   * @param {Object} [config] Contains fields with which constructor will attempt to override defaults.
   */
  constructor(logger, web3, uniswapPriceFeed, medianizerPriceFeed, config) {
    this.logger = logger;

    // Instance of price feeds used to check for deviation of synthetic token price.
    this.uniswapPriceFeed = uniswapPriceFeed;
    this.medianizerPriceFeed = medianizerPriceFeed;

    this.web3 = web3;

    // Contract constants
    // TODO: replace this with an actual query to the collateral currency symbol
    this.collateralCurrencySymbol = "DAI";
    this.syntheticCurrencySymbol = "UMATEST";
    this.pricefeedIdentifierName = "UMATEST/DAI";

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
      },
      volatilityWindow: {
        // `volatilityWindow`: Length of time (in seconds) to snapshot volatility.
        value: 60 * 60, // 1 hour.
        isValid: x => {
          return x >= 0;
        }
      },
      volatilityAlertThreshold: {
        // `volatilityAlertThreshold`: Error threshold for pricefeed's price volatility over `volatilityWindow`.
        // Expressed as a %.
        value: this.web3.utils.toBN(this.web3.utils.toWei("0.05")),
        isValid: x => {
          return toBN(x).lte(toBN(toWei("100"))) && toBN(x).gt(toBN("0"));
        }
      }
    };
    Object.assign(this, createObjectFromDefaultProps(config, defaultConfig));
  }

  // Compares synthetic price on Uniswap with pegged price on medianizer price feed and fires a message
  // if the synythetic price deviates too far from the peg.
  checkPriceDeviation = async () => {
    this.logger.debug({
      at: "SyntheticPegMonitor",
      message: "Checking synthetic price deviation from pricefeed peg"
    });
    // Get the latest prices from the two price feeds.
    const uniswapTokenPrice = this.uniswapPriceFeed.getCurrentPrice();
    const cryptoWatchTokenPrice = this.medianizerPriceFeed.getCurrentPrice();

    if (!uniswapTokenPrice || !cryptoWatchTokenPrice) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Unable to get price",
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

  // Checks difference between minimum and maximum historical price over `volatilityWindow` amount of time.
  // Fires a message if the difference exceeds the `volatilityAlertThreshold` %.
  checkPegVolatility = async () => {
    const pricefeed = this.medianizerPriceFeed;

    this.logger.debug({
      at: "SyntheticPegMonitor",
      message: "Checking peg price volatility"
    });

    const { pricefeedVolatility, pricefeedLatestPrice } = await this._checkPricefeedVolatility(pricefeed);
    if (!pricefeedVolatility || !pricefeedLatestPrice) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Unable to get price",
        pricefeed: "Medianizer",
        pricefeedVolatility: pricefeedVolatility,
        pricefeedLatestPrice: pricefeedLatestPrice
      });
      return;
    }

    // If the volatility percentage is greater than (gt) the threshold send a message.
    if (pricefeedVolatility.gt(this.volatilityAlertThreshold)) {
      this.logger.error({
        at: "SyntheticPegMonitor",
        message: "High peg price volatility alert 😵",
        mrkdwn:
          "Latest updated " +
          this.pricefeedIdentifierName +
          " price is " +
          this.formatDecimalString(pricefeedLatestPrice) +
          ". Price moved " +
          this.formatDecimalString(pricefeedVolatility.muln(100)) +
          "% over the last " +
          formatHours(this.volatilityWindow) +
          " hour(s)."
      });
    }
  };

  checkSyntheticVolatility = async () => {
    const pricefeed = this.uniswapPriceFeed;

    this.logger.debug({
      at: "SyntheticPegMonitor",
      message: "Checking synthetic price volatility"
    });

    const { pricefeedVolatility, pricefeedLatestPrice } = await this._checkPricefeedVolatility(pricefeed);
    if (!pricefeedVolatility || !pricefeedLatestPrice) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Unable to get price",
        pricefeed: "Uniswap",
        pricefeedVolatility: pricefeedVolatility,
        pricefeedLatestPrice: pricefeedLatestPrice
      });
      return;
    }

    // If the volatility percentage is greater than (gt) the threshold send a message.
    if (pricefeedVolatility.gt(this.volatilityAlertThreshold)) {
      this.logger.error({
        at: "SyntheticPegMonitor",
        message: "High synthetic price volatility alert 😵",
        mrkdwn:
          "Latest updated " +
          this.pricefeedIdentifierName +
          " price is " +
          this.formatDecimalString(pricefeedLatestPrice) +
          ". Price moved " +
          this.formatDecimalString(pricefeedVolatility.muln(100)) +
          "% over the last " +
          formatHours(this.volatilityWindow) +
          " hour(s)."
      });
    }
  };

  // Return historical volatility for pricefeed over specified time range and latest price.
  _checkPricefeedVolatility = async pricefeed => {
    // Get all historical prices from `volatilityWindow` seconds before the last update time and
    // record the minimum and maximum.
    const latestTime = pricefeed.getLastUpdateTime();
    const pricefeedVolatility = this._calculateHistoricalVolatility(pricefeed, latestTime, this.volatilityWindow);
    // @dev: This is not `getCurrentTime` in order to enforce that the volatility calculation is counting back from precisely the
    // same timestamp as the "latest price". This would prevent inaccurate volatility readings where `currentTime` differs from `lastUpdateTime`.
    const pricefeedLatestPrice = pricefeed.getHistoricalPrice(latestTime);

    return {
      pricefeedVolatility,
      pricefeedLatestPrice
    };
  };

  // Takes in two big numbers and returns the error between them.
  // calculated using: δ = | (observed - expected) / expected |
  // For example an observed price of 1.2 with an expected price of 1.0 will return | (1.2 - 1.0) / 1.0 | = 0.20
  // This is equivalent of a 20 percent absolute deviation between the numbers.
  _calculateDeviationError(observedValue, expectedValue) {
    return observedValue
      .sub(expectedValue)
      .mul(this.web3.utils.toBN(this.web3.utils.toWei("1"))) // Scale the numerator before division
      .div(expectedValue)
      .abs();
  }

  // Find difference between minimum and maximum prices for given pricefeed from `lookback` seconds in the past
  // until `mostRecentTime`. Returns volatility as (max - min)/min %.
  _calculateHistoricalVolatility(pricefeed, mostRecentTime, lookback) {
    // Set max and min to latest price to start.
    let min = pricefeed.getHistoricalPrice(mostRecentTime);
    let max = min;
    if (!min || !max) return null;

    for (let i = 0; i < lookback; i++) {
      let _price = pricefeed.getHistoricalPrice(mostRecentTime - i);
      if (!_price) {
        continue;
      }

      if (_price.lt(min)) {
        min = _price;
      }
      if (_price.gt(max)) {
        mx = _price;
      }
    }

    // The min-max % calculation is identical to the equation in `_calculateDeviationError`.
    return this._calculateDeviationError(max, min);
  }
}

module.exports = {
  SyntheticPegMonitor
};
