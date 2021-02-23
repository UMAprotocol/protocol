const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@ethersproject/bignumber");
const assert = require("assert");

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
      throw new Error("BasketSpreadPriceFeed: Missing unknown experimental basket price");
    }
    const experimentalMean = this._computeMean(experimentalPrices);

    // Second, compute the average of the baseline pricefeeds.
    if (baselinePrices.length === 0 || baselinePrices.some(element => element === undefined || element === null)) {
      throw new Error("BasketSpreadPriceFeed: Missing unknown baseline basket price");
    }
    const baselineMean = this._computeMean(baselinePrices);

    // All calculations within this if statement will produce unexpected results if any of the
    // experimental mean, baseline mean, or denominator price are NOT in the same precision as
    // the one that this.convertPriceFeedDecimals() uses.
    if (!baselineMean || !experimentalMean)
      throw new Error("BasketSpreadPriceFeed: missing baselineMean or experimentalMean");

    // TODO: Parameterize the lower (0) and upper (2) bounds, as well as allow for custom "spreadValue" formulas,
    // for example we might not want to have the spread centered around 1, like it is here:
    let spreadValue = experimentalMean.sub(baselineMean).add(this.convertPriceFeedDecimals("1"));

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
    spreadValue = spreadValue.mul(this.convertPriceFeedDecimals("1")).div(denominatorPrice);

    return spreadValue;
  }

  getCurrentPrice() {
    const experimentalPrices = this.experimentalPriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    const baselinePrices = this.baselinePriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    const denominatorPrice = this.denominatorPriceFeed && this.denominatorPriceFeed.getCurrentPrice();

    try {
      return this._getSpreadFromBasketPrices(experimentalPrices, baselinePrices, denominatorPrice);
    } catch (err) {
      return null;
    }
  }

  async getHistoricalPrice(time) {
    // If failure to fetch any constituent historical prices, then throw
    // array of errors.
    const errors = [];
    const experimentalPrices = await Promise.all(
      this.experimentalPriceFeeds.map(priceFeed => {
        return priceFeed.getHistoricalPrice(time).catch(err => errors.push(err));
      })
    );
    const baselinePrices = await Promise.all(
      this.baselinePriceFeeds.map(priceFeed => {
        return priceFeed.getHistoricalPrice(time).catch(err => errors.push(err));
      })
    );
    let denominatorPrice;
    if (this.denominatorPriceFeed) {
      denominatorPrice = await this.denominatorPriceFeed.getHistoricalPrice(time).catch(err => errors.push(err));
    }

    if (errors.length > 0) {
      throw errors;
    } else {
      return this._getSpreadFromBasketPrices(experimentalPrices, baselinePrices, denominatorPrice);
    }
  }
  // This searches for closest time in a list of [[time,price]] data. Based on code in affiliates models/prices.
  // input list is [[time,price]]
  // output price as BN
  closestTime(list) {
    return time => {
      const result = list.reduce((a, b) => {
        const aDiff = Math.abs(a[0] - time);
        const bDiff = Math.abs(b[0] - time);

        // if differences are equal, return larger? timestamp
        if (aDiff == bDiff) {
          return a < b ? a : b;
        }
        // if diffs are diff, return smallest diff
        return bDiff < aDiff ? b : a;
      });
      assert(result, "no closest time found");
      return this.toBN(result[1]);
    };
  }
  // This function does something similar to get historicalprice, but does not have the luxury of only caring about a
  // single point in time. It has to run the basketspread price across all timestamps available. This is complicated
  // as there are multiple price histories which we must search through at each matching timestamp to find the closets
  // prices to add into the basket calculation.
  // Returns data in the form of [[time,price]]
  getHistoricalPricePeriods() {
    const experimentalPrices = this.experimentalPriceFeeds.map(priceFeed => {
      // This price history gets wrapped in "closestTime" which returns a searching function with timestamp input.
      return this.closestTime(priceFeed.getHistoricalPricePeriods());
    });
    const baselinePrices = this.baselinePriceFeeds.map(priceFeed => {
      return this.closestTime(priceFeed.getHistoricalPricePeriods());
    });
    let denominatorPrice;
    if (this.denominatorPriceFeed) {
      denominatorPrice = this.closestTime(this.denominatorPriceFeed.getHistoricalPricePeriods());
    }

    // This uses the first baseline price feed as a reference for the historical timestamps to search for
    const pricePeriods = this.baselinePriceFeeds[0].getHistoricalPricePeriods();
    return pricePeriods.map(pricePeriod => {
      const [time] = pricePeriod;
      // Each parameter looks up and returns the closest price to the timestamp.
      const expPrices = experimentalPrices.map(lookup => lookup(time));
      const basePrices = baselinePrices.map(lookup => lookup(time));
      const denomPrices = denominatorPrice ? denominatorPrice(time) : null;

      // Takes in an array of prices for each basket and returns a single price
      return [time, this._getSpreadFromBasketPrices(expPrices, basePrices, denomPrices)];
    });
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

  // Returns the shortest lookback window of the constituent price feeds.
  getLookback() {
    const lookbacks = this.allPriceFeeds.map(priceFeed => priceFeed.getLookback());
    if (lookbacks.some(element => element === undefined || element === null)) {
      return null;
    }
    return Math.min(...lookbacks);
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
