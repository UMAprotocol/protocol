const { PriceFeedInterface } = require("./PriceFeedInterface");

// An implementation of PriceFeedInterface that medianizes other price feeds.
class MedianizerPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new MedianizerPriceFeed.
   * @param {List} priceFeeds a list of priceFeeds to medianize. All elements must be of type PriceFeedInterface.
   *      Must be an array of at least one element.
   */
  constructor(priceFeeds) {
    super();

    if (priceFeeds.length === 0) {
      throw new Error("MedianizerPriceFeed cannot be constructed with no constituent price feeds.");
    }

    this.priceFeeds = priceFeeds;
  }

  // Takes the median of all of the constituent price feeds' currentPrices.
  getCurrentPrice() {
    const currentPrices = this.priceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    if (currentPrices.some(element => element === undefined || element === null)) {
      return null;
    }

    return this._computeMedian(currentPrices);
  }

  // Takes the median of all of the constituent price feeds' historical prices.
  getHistoricalPrice(time) {
    const historicalPrices = this.priceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));

    if (historicalPrices.some(element => element === undefined || element === null)) {
      return null;
    }

    return this._computeMedian(historicalPrices);
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
    for (const priceFeed of this.priceFeeds) {
      await priceFeed.update();
    }
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
}

module.exports = {
  MedianizerPriceFeed
};
