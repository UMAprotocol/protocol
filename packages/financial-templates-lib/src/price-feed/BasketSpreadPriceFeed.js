const { PriceFeedInterface } = require("./PriceFeedInterface");

// An implementation of PriceFeedInterface that takes as input two sets ("baskets") of price feeds,
// computes the average price feed for each basket, and returns the spread between the two averages.
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
   *      in order to "denominate" the basket spread price in a specified unit. For example, we might want to express the basekt spread in terms
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
  }

  // Compute the spread between the baseline and experimental pricefeeds.
  getCurrentPrice() {
    // First, compute the average of the experimental pricefeeds.
    this.experimentalPriceFeeds.map(priceFeed => {
      priceFeed;
    });
    const experimentalPrices = this.experimentalPriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
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
    const baselinePrices = this.baselinePriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    if (baselinePrices.length === 0 || baselinePrices.some(element => element === undefined || element === null)) {
      return null;
    }
    const baselineMean = this._computeMean(baselinePrices);
    this.logger.debug({
      at: "BasketSpreadPriceFeed",
      message: "Average of baseline prices",
      mean: baselineMean.toString()
    });

    // If denominator price feed exists, get its price.
    const denominatorPrice = this.denominatorPriceFeed.getCurrentPrice();
    this.logger.debug({
      at: "BasketSpreadPriceFeed",
      message: "Denominator price",
      denominatorPrice: denominatorPrice.toString()
    });

    if (baselineMean && experimentalMean) {
      let spreadValue = experimentalMean.sub(baselineMean).add(this.toBN(this.toWei("1")));
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
      else if (spreadValue.gt(this.toBN(this.toWei("2")))) {
        spreadValue = this.toBN(this.toWei("2"));
      }

      // Optionally, divide by denominator pricefeed.
      if (denominatorPrice) {
        spreadValue = spreadValue.mul(this.toBN(this.toWei("1"))).div(denominatorPrice);
      }

      return spreadValue;
    } else {
      // Something went wrong in the _computeMean step
      return null;
    }
  }

  // Takes the median of all of the constituent price feeds' historical prices.
  getHistoricalPrice() {
    // todo
  }

  getHistoricalPricePeriods() {
    // todo
  }

  // Gets the *most recent* update time for all constituent price feeds.
  getLastUpdateTime() {
    const lastUpdateTimes = this.priceFeeds.map(priceFeed => priceFeed.getLastUpdateTime());

    if (lastUpdateTimes.some(element => element === undefined || element === null)) {
      return null;
    }

    // Take the most recent update time.
    return Math.max(...lastUpdateTimes);
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
