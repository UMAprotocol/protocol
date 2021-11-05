// This module monitors the synthetic peg of a given expiring multiparty contract and reports when: 1) the synthetic is
// trading off peg 2) there is high volatility in the synthetic price or 3) there is high volatility in the reference price.

const { ConvertDecimals, createFormatFunction, formatHours, createObjectFromDefaultProps } = require("@uma/common");
const { calculateDeviationError } = require("@uma/financial-templates-lib");

// TODO: Rename "medianizerPriceFeed" ==> "pegPriceFeed" and "uniswapPriceFeed" ==> "syntheticPriceFeed"
class SyntheticPegMonitor {
  /**
   * @notice Constructs new synthetic peg monitor module.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Instance of a web3 client provided by the class that initiates the monitor module.
   * @param {Object} uniswapPriceFeed Module used to query the current uniswap token price.
   * @param {Object} medianizerPriceFeed Module used to query the median price among selected price feeds.
   * @param {Object} denominatorPriceFeed Optional module that can be used to divide the price returned by the
   * `medianizerPriceFeed` in order to "denominator" that price in a new currency.
   * @param {Object} [monitorConfig] Contains fields with which constructor will attempt to override defaults. Example:
  *      { deviationAlertThreshold:0.2,           // Threshold used to compare observed and expected token prices.
           volatilityWindow: 600,                 // Length of time (in seconds) to snapshot volatility.
           pegVolatilityAlertThreshold: 0.2,      // Threshold for synthetic peg price volatility.
           syntheticVolatilityAlertThreshold: 0.2 // Threshold for synthetic price volatility.
           logOverrides: {deviation: "error"}     // Log level overrides.
          }
   * @param {Object} financialContractProps Configuration object used to inform logs of key Financial Contract information. Example:
   *      { syntheticSymbol:"ETHBTC",
            priceIdentifier: "ETH/BTC",
            priceFeedDecimals: 18, }
   * @param {Object} financialContractClient Client used to query Financial Contract state.
   */
  constructor({
    logger,
    web3,
    uniswapPriceFeed,
    medianizerPriceFeed,
    denominatorPriceFeed,
    monitorConfig,
    financialContractProps,
    financialContractClient,
  }) {
    this.logger = logger;

    // Instance of price feeds used to check for deviation of synthetic token price.
    this.uniswapPriceFeed = uniswapPriceFeed;
    this.medianizerPriceFeed = medianizerPriceFeed;
    this.denominatorPriceFeed = denominatorPriceFeed;

    this.web3 = web3;

    // We'll use this to fetch the contract's funding rate multiplier if possible.
    this.financialContractClient = financialContractClient;

    this.normalizePriceFeedDecimals = ConvertDecimals(financialContractProps.priceFeedDecimals, 18, this.web3);

    this.formatDecimalString = createFormatFunction(2, 4);

    // Default config settings. SyntheticPegMonitor deployer can override these settings by passing in new
    // values via the `monitorConfig` input object. The `isValid` property is a function that should be called
    // before resetting any config settings. `isValid` must return a Boolean. If the associated price feed is missing
    // then the defaults to 0 thresholds. This will skip the check in the respective functions.
    const defaultConfig = {
      deviationAlertThreshold: {
        // `deviationAlertThreshold`: Error threshold used to compare observed and expected token prices.
        // If the deviation in token price exceeds this value an alert is fired. If set to zero then fire no logs.
        value: uniswapPriceFeed && medianizerPriceFeed ? 0.2 : 0,
        isValid: (x) => {
          return typeof x === "number" && x < 1 && x >= 0;
        },
      },
      volatilityWindow: {
        // `volatilityWindow`: Length of time (in seconds) to snapshot volatility.
        value: uniswapPriceFeed || medianizerPriceFeed ? 60 * 10 : 0, // 10 minutes
        isValid: (x) => {
          return typeof x === "number" && x >= 0;
        },
      },
      pegVolatilityAlertThreshold: {
        // `pegVolatilityAlertThreshold`: Error threshold for synthetic peg price volatility over `volatilityWindow`.
        value: uniswapPriceFeed ? 0.1 : 0,
        isValid: (x) => {
          return typeof x === "number" && x < 1 && x >= 0;
        },
      },
      syntheticVolatilityAlertThreshold: {
        // `syntheticVolatilityAlertThreshold`: Error threshold for synthetic price volatility over `volatilityWindow`.
        value: medianizerPriceFeed ? 0.1 : 0,
        isValid: (x) => {
          return typeof x === "number" && x < 1 && x >= 0;
        },
      },
      logOverrides: {
        // Specify an override object to change default logging behaviour. Defaults to no overrides. If specified, this
        // object is structured to contain key for the log to override and value for the logging level. EG:
        // { deviation:'error' } would override the default `warn` behaviour for synthetic-peg deviation events.
        value: {},
        isValid: (overrides) => {
          // Override must be one of the default logging levels: ['error','warn','info','http','verbose','debug','silly']
          return Object.values(overrides).every((param) => Object.keys(this.logger.levels).includes(param));
        },
      },
    };
    Object.assign(this, createObjectFromDefaultProps(monitorConfig, defaultConfig));

    // Validate the financialContractProps object. This contains a set of important info within it so need to be sure it's structured correctly.
    const defaultFinancialContractProps = {
      financialContractProps: {
        value: {},
        isValid: (x) => {
          // The config must contain the following keys and types:
          return (
            Object.keys(x).includes("priceIdentifier") &&
            typeof x.priceIdentifier === "string" &&
            Object.keys(x).includes("syntheticSymbol") &&
            typeof x.syntheticSymbol === "string" &&
            Object.keys(x).includes("priceFeedDecimals") &&
            typeof x.priceFeedDecimals === "number"
          );
        },
      },
    };
    Object.assign(this, createObjectFromDefaultProps({ financialContractProps }, defaultFinancialContractProps));

    // Helper functions from web3.
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
  }

  // Compares synthetic price on Uniswap with pegged price on medianizer price feed and fires a message
  // if the synythetic price deviates too far from the peg. If deviationAlertThreshold == 0 then do nothing.
  async checkPriceDeviation() {
    if (this.deviationAlertThreshold === 0) return; // return early if the threshold is zero.
    // Get the latest prices from the two price feeds.
    let uniswapTokenPrice = this.uniswapPriceFeed.getCurrentPrice();
    let cryptoWatchTokenPrice = this.medianizerPriceFeed.getCurrentPrice();
    // Multiply identifier price by funding rate multiplier to get its adjusted price:
    if (this.financialContractClient?.latestCumulativeFundingRateMultiplier) {
      cryptoWatchTokenPrice = this.toBN(cryptoWatchTokenPrice.toString())
        .mul(this.financialContractClient.latestCumulativeFundingRateMultiplier)
        .div(this.toBN(this.toWei("1"))); // We can assume that the CFRM is in 18 decimal precision.
    }

    if (!uniswapTokenPrice || !cryptoWatchTokenPrice) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Unable to get price",
        uniswapTokenPrice: uniswapTokenPrice ? uniswapTokenPrice.toString() : "N/A",
        cryptoWatchTokenPrice: cryptoWatchTokenPrice ? cryptoWatchTokenPrice.toString() : "N/A",
      });
      return;
    }

    // If config includes a `denominatorPriceFeed` then query its price. The peg deviation will compare:
    // (syntheticTokenPrice / denominatorPrice) against (pegTokenPrice).
    // If `denominatorPriceFeed` is undefined, then just compare:
    // (syntheticTokenPrice) against (pegTokenPrice).
    if (this.denominatorPriceFeed) {
      const denominatorPrice = this.denominatorPriceFeed.getCurrentPrice();
      // We need a "1" scaled in the same precision that the `denominatorPrice` is getting returned in, because
      // we want to apply the transformation:
      // - uniswapTokenPrice * denominatorPriceFeedScaledOne / denominatorPrice
      // which ultimately should maintain the `uniswapTokenPrice`'s precision.
      const denominatorPriceFeedScaledOne = ConvertDecimals(
        0,
        this.denominatorPriceFeed.getPriceFeedDecimals(),
        this.web3
      )("1");
      uniswapTokenPrice = uniswapTokenPrice.mul(denominatorPriceFeedScaledOne).div(denominatorPrice);
    }

    this.logger.debug({
      at: "SyntheticPegMonitor",
      message: "Checking price deviation",
      uniswapTokenPrice: uniswapTokenPrice.toString(),
      cryptoWatchTokenPrice: cryptoWatchTokenPrice.toString(),
    });

    const deviationError = this._calculateDeviationError(uniswapTokenPrice, cryptoWatchTokenPrice);
    // If the percentage error is greater than (gt) the threshold send a message.
    if (deviationError.abs().gt(this.toBN(this.toWei(this.deviationAlertThreshold.toString())))) {
      this.logger[this.logOverrides.deviation || "warn"]({
        at: "SyntheticPegMonitor",
        message: "Synthetic off peg alert 😵",
        mrkdwn:
          "Synthetic token " +
          this.financialContractProps.syntheticSymbol +
          " is trading at " +
          this.formatDecimalString(this.normalizePriceFeedDecimals(uniswapTokenPrice)) +
          " on Uniswap. Target price is " +
          this.formatDecimalString(this.normalizePriceFeedDecimals(cryptoWatchTokenPrice)) +
          ". Error of " +
          this.formatDecimalString(deviationError.muln(100)) + // multiply by 100 to make the error a percentage
          "%.",
        notificationPath: "risk-management",
      });
    }
  }

  // Checks difference between minimum and maximum historical price over `volatilityWindow` amount of time.
  // Fires a message if the difference exceeds the `volatilityAlertThreshold` %. `checkPegVolatility` checks if the
  // reference medianizer price feed has a large % change over the window.
  async checkPegVolatility() {
    if (this.pegVolatilityAlertThreshold === 0) return; // Exit early if not monitoring peg volatility.
    const pricefeed = this.medianizerPriceFeed;

    // _checkPricefeedVolatility either returns successfully or throws
    let volData;
    try {
      volData = await this._checkPricefeedVolatility(pricefeed);
    } catch (error) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Unable to get volatility data, missing historical price data",
        error,
        lookback: this.volatilityWindow,
      });
      return;
    }

    const pricefeedVolatility = volData.pricefeedVolatility;
    const pricefeedLatestPrice = volData.pricefeedLatestPrice;
    const min = volData.min;
    const max = volData.max;

    this.logger.debug({
      at: "SyntheticPegMonitor",
      message: "Checking peg price volatility",
      pricefeedVolatility: pricefeedVolatility.toString(),
      pricefeedLatestPrice: pricefeedLatestPrice.toString(),
      minPrice: min.toString(),
      maxPrice: max.toString(),
    });

    // If the volatility percentage is greater than (gt) the threshold send a message.
    if (pricefeedVolatility.abs().gt(this.toBN(this.toWei(this.pegVolatilityAlertThreshold.toString())))) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Peg price volatility alert 🌋",
        mrkdwn:
          "Latest updated " +
          this.financialContractProps.priceIdentifier +
          " price is " +
          this.formatDecimalString(this.normalizePriceFeedDecimals(pricefeedLatestPrice)) +
          ". Price moved " +
          this.formatDecimalString(pricefeedVolatility.muln(100)) + // Note no normalizePriceFeedDecimals as this is unitless
          "% over the last " +
          formatHours(this.volatilityWindow) +
          " hour(s). Threshold is " +
          this.pegVolatilityAlertThreshold * 100 +
          "%.",
        notificationPath: "risk-management",
      });
    }
  }

  // `checkSyntheticVolatility` checks if the synthetic uniswap price feed has a large % change over the window.
  async checkSyntheticVolatility() {
    if (this.syntheticVolatilityAlertThreshold === 0) return; // Exit early if not monitoring synthetic volatility.
    const pricefeed = this.uniswapPriceFeed;

    // _checkPricefeedVolatility either returns successfully or throws
    let volData;
    try {
      volData = await this._checkPricefeedVolatility(pricefeed);
    } catch (error) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Unable to get volatility data, missing historical price data",
        error,
        lookback: this.volatilityWindow,
      });
      return;
    }

    const pricefeedVolatility = volData.pricefeedVolatility;
    const pricefeedLatestPrice = volData.pricefeedLatestPrice;
    const min = volData.min;
    const max = volData.max;

    this.logger.debug({
      at: "SyntheticPegMonitor",
      message: "Checking synthetic price volatility",
      pricefeedVolatility: pricefeedVolatility.toString(),
      pricefeedLatestPrice: pricefeedLatestPrice.toString(),
      minPrice: min.toString(),
      maxPrice: max.toString(),
    });

    // If the volatility percentage is greater than (gt) the threshold send a message.
    if (pricefeedVolatility.abs().gt(this.toBN(this.toWei(this.syntheticVolatilityAlertThreshold.toString())))) {
      this.logger.warn({
        at: "SyntheticPegMonitor",
        message: "Synthetic price volatility alert 🌋",
        mrkdwn:
          "Latest updated " +
          this.financialContractProps.priceIdentifier +
          " price is " +
          this.formatDecimalString(this.normalizePriceFeedDecimals(pricefeedLatestPrice)) +
          ". Price moved " +
          this.formatDecimalString(pricefeedVolatility.muln(100)) + // Note no normalizePriceFeedDecimals as this is unitless
          "% over the last " +
          formatHours(this.volatilityWindow) +
          " hour(s). Threshold is " +
          this.syntheticVolatilityAlertThreshold * 100 +
          "%.",
        notificationPath: "risk-management",
      });
    }
  }

  // Return historical volatility for pricefeed over specified time range and latest price,
  // or returns the timestamp from which historical price cannot be found.
  async _checkPricefeedVolatility(pricefeed) {
    // Get all historical prices from `volatilityWindow` seconds before the last update time and
    // record the minimum and maximum.
    const latestTime = pricefeed.getLastUpdateTime();

    // @dev: This might mean that the current price reported is a bit after the volatility window, but the error
    // should be small enough that it shouldn't impact the results. Furthermore, the price is not used in the vol
    // computation (which depends on the min/max), it only is reported alongside it as a reference point.
    let pricefeedLatestPrice;
    try {
      pricefeedLatestPrice = pricefeed.getCurrentPrice();
    } catch (error) {
      this.logger.debug({ at: "SyntheticPegMonitor", message: "Issue getting current price", error });
      pricefeedLatestPrice = null;
    }

    // `_calculateHistoricalVolatility` will throw an error if it does not return successfully.
    const volData = await this._calculateHistoricalVolatility(pricefeed, latestTime, this.volatilityWindow);

    return { pricefeedVolatility: volData.volatility, pricefeedLatestPrice, min: volData.min, max: volData.max };
  }

  _calculateDeviationError(observedValue, expectedValue) {
    return calculateDeviationError(
      this.normalizePriceFeedDecimals(observedValue),
      this.normalizePriceFeedDecimals(expectedValue),
      this.toBN(this.toWei("1")) // We want deviation expressed in 18 decimal precision.
    );
  }

  // Find difference between minimum and maximum prices for given pricefeed from `lookback` seconds in the past
  // until `mostRecentTime`. Returns volatility as (max - min)/min %. Also Identifies the direction volatility movement.
  async _calculateHistoricalVolatility(pricefeed, mostRecentTime, lookback) {
    let min, max;

    // Store the timestamp of the max and min value to infer the direction of the movement over the interval.
    let maxTimestamp = 0,
      minTimestamp = 0;
    // Iterate over all time series values to fine the maximum and minimum values.
    // Note: Save last pricefeed error in order to provide more detailed explanation
    // if price feed fails to return a historical price.
    let lastPriceFeedError;
    for (let i = 0; i < lookback; i++) {
      const timestamp = mostRecentTime - i;
      let _price;
      try {
        _price = await pricefeed.getHistoricalPrice(timestamp);
        if (!_price) continue;
      } catch (err) {
        lastPriceFeedError = err;
        continue;
      }

      // Set default values for min and max to the most recent non-null price.
      if (!min) {
        min = _price;
      }
      if (!max) {
        max = _price;
      }

      if (_price.lt(min)) {
        min = _price;
        minTimestamp = timestamp;
      }
      if (_price.gt(max)) {
        max = _price;
        maxTimestamp = timestamp;
      }
    }

    // If there are no valid prices in the time window from `mostRecentTime` to `mostRecentTime - lookback`, throw.
    if (!min || !max) {
      if (lastPriceFeedError) {
        throw lastPriceFeedError;
      } else {
        throw new Error("No min or max within lookback window");
      }
    }

    // If maxTimestamp < minTimestamp then positive volatility. If minTimestamp < maxTimestamp then negative volatility.
    // Note:this inequality intuitively feels backwards. This is because the for loop above itterates from the current
    // time back over the lookback duration rather than traversing time forwards from the lookback duration to present.
    const volatilityDirection = maxTimestamp < minTimestamp ? 1 : -1;

    // The min-max % calculation is identical to the equation in `_calculateDeviationError`.
    return {
      min: min,
      max: max,
      volatility: this._calculateDeviationError(max, min).mul(this.toBN(volatilityDirection)),
    };
  }
}

module.exports = { SyntheticPegMonitor };
