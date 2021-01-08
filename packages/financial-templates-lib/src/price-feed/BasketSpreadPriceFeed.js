const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@ethersproject/bignumber");

// An implementation of PriceFeedInterface that takes as input two sets ("baskets") of price feeds,
// computes the average price feed for each basket, and returns the spread between the two averages.
// !!Note: This PriceFeed assumes that the baselinePriceFeeds, experimentalPriceFeed, and denominatorPriceFeed
// are all returning prices in the same precision as `decimals`.
class BasketSpreadPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new BasketSpreadPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {List} baselinePriceFeeds The baseline list of priceFeeds to compute the average of. All elements must be of type PriceFeedInterface.
   *      Must be an array of at least one element.
   * @param {List} experimentalPriceFeed The baseline list of priceFeeds to compute the average of. All elements must be of type PriceFeedInterface.
   *      Must be an array of at least one element.
   * @param {Object?} denominatorPriceFeed We optionally divide the price spread between the baseline and experimental baskets by this denominator price
   *      in order to "denominate" the basket spread price in a specified unit. For example, we might want to express the basket spread in terms
   *      of ETH-USD.
   */
  constructor(web3, logger, baselinePriceFeeds, experimentalPriceFeeds, denominatorPriceFeed) {
    super();

    if (baselinePriceFeeds.length === 0 || experimentalPriceFeeds.length === 0) {
      throw new Error("BasketSpreadPriceFeed cannot be constructed with empty baseline or experimental baskets.");
    }

    this.baselinePriceFeeds = baselinePriceFeeds;
    this.experimentalPriceFeeds = experimentalPriceFeeds;
    this.denominatorPriceFeed = denominatorPriceFeed;

    // For convenience, concatenate all constituent price feeds.
    this.allPriceFeeds = this.baselinePriceFeeds.concat(this.experimentalPriceFeeds);
    if (this.denominatorPriceFeed) {
      this.allPriceFeeds = this.allPriceFeeds.concat(this.denominatorPriceFeed);
    }

    // Helper modules.
    this.web3 = web3;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.logger = logger;

    // The precision that the user wants to return prices in must match all basket constituent price feeds and the denominator.
    this.decimals = this.allPriceFeeds[0].getPriceFeedDecimals();

    // Scale `number` by 10**decimals.
    this.convertPriceFeedDecimals = number => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number
      return this.toBN(parseFixed(number.toString(), this.decimals).toString());
    };
  }

  // Given lists of experimental and baseline prices, and a denominator price,
  // return the spread price, which is:
  // (avg(experimental) - avg(baseline) + 1) / denominator
  _getSpreadFromBasketPrices(experimentalPrices, baselinePrices, denominatorPrice) {
    // Compute experimental basket mean.
    if (
      experimentalPrices.length === 0 ||
      experimentalPrices.some(element => element === undefined || element === null)
    ) {
      return null;
    }
    const experimentalMean = this._computeMean(experimentalPrices);
    this.logger.debug({
      at: "BasketSpreadPriceFeed",
      message: "Average of experimental prices",
      mean: experimentalMean.toString()
    });

    // Second, compute the average of the baseline pricefeeds.
    if (baselinePrices.length === 0 || baselinePrices.some(element => element === undefined || element === null)) {
      return null;
    }
    const baselineMean = this._computeMean(baselinePrices);
    this.logger.debug({
      at: "BasketSpreadPriceFeed",
      message: "Average of baseline prices",
      mean: baselineMean.toString()
    });

    // All calculations within this if statement will produce unexpected results if any of the
    // experimental mean, baseline mean, or denominator price are NOT in the same precision as
    // the one that this.convertPriceFeedDecimals() uses.
    if (!baselineMean || !experimentalMean) return null;

    // TODO: Parameterize the lower (0) and upper (2) bounds, as well as allow for custom "spreadValue" formulas,
    // for example we might not want to have the spread centered around 1, like it is here:
    let spreadValue = experimentalMean.sub(baselineMean).add(this.convertPriceFeedDecimals("1"));
    this.logger.debug({
      at: "BasketSpreadPriceFeed",
      message: "Basket spread value",
      spreadValue: spreadValue.toString()
    });

    // Ensure non-negativity
    if (spreadValue.lt(this.toBN("0"))) {
      spreadValue = this.toBN("0");
    }
    // Ensure symmetry
    else if (spreadValue.gt(this.convertPriceFeedDecimals("2"))) {
      spreadValue = this.convertPriceFeedDecimals("2");
    }

    // Optionally divide by denominator pricefeed.
    if (!denominatorPrice) return spreadValue;
    this.logger.debug({
      at: "BasketSpreadPriceFeed",
      message: "Denominator price",
      denominatorPrice: denominatorPrice.toString()
    });
    spreadValue = spreadValue.mul(this.convertPriceFeedDecimals("1")).div(denominatorPrice);

    return spreadValue;
  }

  getCurrentPrice() {
    const experimentalPrices = this.experimentalPriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    const baselinePrices = this.baselinePriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    const denominatorPrice = this.denominatorPriceFeed && this.denominatorPriceFeed.getCurrentPrice();

    return this._getSpreadFromBasketPrices(experimentalPrices, baselinePrices, denominatorPrice);
  }

  getHistoricalPrice(time) {
    const experimentalPrices = this.experimentalPriceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));
    const baselinePrices = this.baselinePriceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));
    const denominatorPrice = this.denominatorPriceFeed && this.denominatorPriceFeed.getHistoricalPrice(time);

    return this._getSpreadFromBasketPrices(experimentalPrices, baselinePrices, denominatorPrice);
  }

  // Gets the *most recent* update time for all constituent price feeds.
  getLastUpdateTime() {
    const lastUpdateTimes = this.allPriceFeeds.map(priceFeed => priceFeed.getLastUpdateTime());
    if (lastUpdateTimes.some(element => element === undefined || element === null)) {
      return null;
    }

    // Take the most recent update time.
    return Math.max(...lastUpdateTimes);
  }

  getPriceFeedDecimals() {
    // Check that every price feeds decimals are the same.
    const priceFeedDecimals = this.allPriceFeeds.map(priceFeed => priceFeed.getPriceFeedDecimals());
    if (!priceFeedDecimals.every(feedDecimals => feedDecimals === this.decimals)) {
      throw new Error("BasketPriceFeed's constituent feeds do not all match the denominator price feed's precision!");
    }

    return this.decimals;
  }

  // Updates all constituent price feeds.
  async update() {
    await Promise.all(this.allPriceFeeds.map(priceFeed => priceFeed.update()));
  }

  // Inputs are expected to be BNs.
  _computeMean(inputs) {
    let sum = this.toBN("0");

    for (let priceBN of inputs) {
      sum = sum.add(priceBN);
    }

    return sum.divn(inputs.length);
  }
}

module.exports = {
  BasketSpreadPriceFeed
};
