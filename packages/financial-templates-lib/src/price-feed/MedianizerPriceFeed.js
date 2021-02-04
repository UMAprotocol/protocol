const { PriceFeedInterface } = require("./PriceFeedInterface");

// An implementation of PriceFeedInterface that medianizes other price feeds.
class MedianizerPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new MedianizerPriceFeed.
   * @param {List} priceFeeds a list of priceFeeds to medianize. All elements must be of type PriceFeedInterface.
   *      Must be an array of at least one element.
   * @param {Boolean=false} computeMean Set this to true to return the mean over price feeds instead of the median.
   *      Default behavior is to return median.
   */
  constructor(priceFeeds, computeMean = false) {
    super();

    if (priceFeeds.length === 0) {
      throw new Error("MedianizerPriceFeed cannot be constructed with no constituent price feeds.");
    }

    this.priceFeeds = priceFeeds;
    this.computeMean = computeMean;
  }

  // Takes the median of all of the constituent price feeds' currentPrices.
  getCurrentPrice() {
    const currentPrices = this.priceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    if (currentPrices.some(element => element === undefined || element === null)) {
      return null;
    }

    if (this.computeMean) {
      return this._computeMean(currentPrices);
    } else {
      return this._computeMedian(currentPrices);
    }
  }

  // Takes the median of all of the constituent price feeds' historical prices.
  async getHistoricalPrice(time, verbose = false) {
    // If failure to fetch any constituent historical prices, then throw
    // array of errors.
    let errors = [];
    let historicalPrices = await Promise.all(
      this.priceFeeds.map(priceFeed => {
        return priceFeed.getHistoricalPrice(time, verbose).catch(err => errors.push(err));
      })
    );

    if (errors.length > 0) {
      throw errors;
    } else {
      if (this.computeMean) {
        return this._computeMean(historicalPrices);
      } else {
        return this._computeMedian(historicalPrices);
      }
    }
  }

  // Note: This method will fail if one of the pricefeeds has not implemented `getHistoricalPricePeriods`, which
  // is basically every price feed except for the CryptoWatchPriceFeed.
  getHistoricalPricePeriods() {
    // Fetch all historical price data for all price feeds within the medianizer set.
    const historicalPricePeriods = this.priceFeeds.map(priceFeed => priceFeed.getHistoricalPricePeriods());

    let processedMedianHistoricalPricePeriods = [];

    // For each discrete point in time within the set of price feeds iterate over and compute the median.
    for (let pricePointIndex = 0; pricePointIndex < historicalPricePeriods[0].length; pricePointIndex++) {
      // Create an array of prices at the pricePointIndex for each price feed. The median is taken over this set.
      const periodPrices = historicalPricePeriods.map(historicalPrice => {
        return historicalPrice[pricePointIndex]
          ? historicalPrice[pricePointIndex].closePrice
          : this.priceFeeds[0].toBN("0");
      });
      processedMedianHistoricalPricePeriods[pricePointIndex] = [
        historicalPricePeriods[0][pricePointIndex].closeTime,
        this.computeMean ? this._computeMean(periodPrices).toString() : this._computeMedian(periodPrices).toString()
      ];
    }
    return processedMedianHistoricalPricePeriods;
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

  // Gets the decimals of the medianized price feeds. Errors out if any price feed had a different number of decimals.
  getPriceFeedDecimals() {
    const priceFeedDecimals = this.priceFeeds.map(priceFeed => priceFeed.getPriceFeedDecimals());
    // Check that every price feeds decimals match the 0th price feeds decimals.
    if (!priceFeedDecimals[0] || !priceFeedDecimals.every(feedDecimals => feedDecimals === priceFeedDecimals[0])) {
      throw new Error("MedianizerPriceFeed's feeds do not all have the same decimals or invalid decimals!");
    }

    return priceFeedDecimals[0];
  }

  // Returns the shortest lookback window of the constituent price feeds.
  getLookback() {
    const lookbacks = this.priceFeeds.map(priceFeed => priceFeed.getLookback());
    if (lookbacks.some(element => element === undefined || element === null)) {
      return null;
    }
    return Math.min(...lookbacks);
  }

  // Updates all constituent price feeds.
  async update() {
    await Promise.all(this.priceFeeds.map(priceFeed => priceFeed.update()));
  }

  // Inputs are expected to be BNs.
  _computeMedian(inputs) {
    inputs.sort((a, b) => a.cmp(b));

    // Compute midpoint (top index / 2).
    const maxIndex = inputs.length - 1;
    const midpoint = maxIndex / 2;

    // If the count is odd, the midpoint will land on a whole number, taking an average of the same number.
    // If the count is even, the midpoint will land on X.5, averaging the index below and above.
    return inputs[Math.floor(midpoint)].add(inputs[Math.ceil(midpoint)]).divn(2);
  }
  _computeMean(inputs) {
    let sum = undefined;

    for (let priceBN of inputs) {
      if (sum === undefined) {
        sum = priceBN;
      } else {
        sum = sum.add(priceBN);
      }
    }

    return sum.divn(inputs.length);
  }
}

module.exports = {
  MedianizerPriceFeed
};
