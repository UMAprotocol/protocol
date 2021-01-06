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
   * @param {Object} denominatorPriceFeed We divide the price spread between the baseline and experimental baskets by this denominator price
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

    // Helper modules.
    this.web3 = web3;
    this.toBN = this.web3.utils.toBN;
    this.toWei = this.web3.utils.toWei;
    this.logger = logger;

    // The precision that the user wants to return prices in is determined by the denominator price feed.
    this.decimals = denominatorPriceFeed.getPriceFeedDecimals();

    // Scale `number` by 10**decimals.
    this.convertDecimals = number => {
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
    // the one that this.convertDecimals() uses.
    if (baselineMean && experimentalMean) {
      let spreadValue = experimentalMean.sub(baselineMean).add(this.convertDecimals("1"));
      this.logger.debug({
        at: "BasketSpreadPriceFeed",
        message: "Basket spread value",
        spreadValue: spreadValue.toString()
      });

      // TODO: Parameterize these lower and upper bounds, as well as allow for custom "spreadValue" formulas,
      // for example we might not want to have the spread centered around 1.

      // Ensure non-negativity
      if (spreadValue.lt(this.toBN("0"))) {
        spreadValue = this.toBN("0");
      }
      // Ensure symmetry
      else if (spreadValue.gt(this.convertDecimals("2"))) {
        spreadValue = this.convertDecimals("2");
      }

      // Divide by denominator pricefeed.
      if (denominatorPrice) {
        this.logger.debug({
          at: "BasketSpreadPriceFeed",
          message: "Denominator price",
          denominatorPrice: denominatorPrice.toString()
        });
        spreadValue = spreadValue.mul(this.convertDecimals("1")).div(denominatorPrice);
      } else {
        return null;
      }

      return spreadValue;
    } else {
      // Something went wrong in the _computeMean step
      return null;
    }
  }

  getCurrentPrice() {
    const experimentalPrices = this.experimentalPriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    const baselinePrices = this.baselinePriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    const denominatorPrice = this.denominatorPriceFeed.getCurrentPrice();

    return this._getSpreadFromBasketPrices(experimentalPrices, baselinePrices, denominatorPrice);
  }

  getHistoricalPrice(time) {
    const experimentalPrices = this.experimentalPriceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));
    const baselinePrices = this.baselinePriceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));
    const denominatorPrice = this.denominatorPriceFeed.getHistoricalPrice(time);

    return this._getSpreadFromBasketPrices(experimentalPrices, baselinePrices, denominatorPrice);
  }

  // Gets the *most recent* update time for all constituent price feeds.
  getLastUpdateTime() {
    const lastUpdateTimes = this.experimentalPriceFeeds
      .concat(this.baselinePriceFeeds)
      .concat(this.denominatorPriceFeed)
      .map(priceFeed => priceFeed.getLastUpdateTime());
    if (lastUpdateTimes.some(element => element === undefined || element === null)) {
      return null;
    }

    // Take the most recent update time.
    return Math.max(...lastUpdateTimes);
  }

  getPriceFeedDecimals() {
    const experimentalDecimals = this.experimentalPriceFeeds.map(priceFeed => priceFeed.getPriceFeedDecimals());
    const baselineDecimals = this.baselinePriceFeeds.map(priceFeed => priceFeed.getPriceFeedDecimals());

    // Check that every price feeds decimals match the 0th price feeds decimals.
    if (
      !experimentalDecimals.every(feedDecimals => feedDecimals === this.decimals) ||
      !baselineDecimals.every(feedDecimals => feedDecimals === this.decimals)
    ) {
      throw new Error("BasketPriceFeed's constituent feeds do not all match the denominator price feed's precision!");
    }

    return this.decimals;
  }

  // Updates all constituent price feeds.
  async update() {
    await Promise.all(
      this.baselinePriceFeeds
        .map(priceFeed => priceFeed.update())
        .concat(this.experimentalPriceFeeds.map(priceFeed => priceFeed.update()))
        .concat(this.denominatorPriceFeed.update())
    );
  }

  // Inputs are expected to be BNs.
  _computeMean(inputs) {
    let sum = this.toBN("0");

    for (let priceBN of inputs) {
      sum = sum.add(priceBN);
    }

    return sum.div(this.toBN(inputs.length));
  }
}

module.exports = {
  BasketSpreadPriceFeed
};
