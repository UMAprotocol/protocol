const { PriceFeedInterface } = require("./PriceFeedInterface");

// An implementation of PriceFeedInterface that medianizes other price feeds.
class MedianizerPriceFeed extends PriceFeedInterface {
  // Constructs the MedianizerPriceFeed.
  // priceFeeds a list of priceFeeds to medianize. All elements must be of type PriceFeedInterface. Must be an array of
  // at least one element.
  constructor(priceFeeds) {
    super();

    if (priceFeeds.length === 0) {
      throw "MedianizerPriceFeed cannot be constructed with no constituent price feeds.";
    }

    this.priceFeeds = priceFeeds;
  }

  getCurrentPrice() {
    const currentPrices = this.priceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    if (currentPrices.some(element => element === undefined || element === null)) {
      return null;
    }

    return _computeMedian(currentPrices);
  }

  getHistoricalPrice(time) {
    const historicalPrices = this.priceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));

    if (currentPrices.some(element => element === undefined || element === null)) {
      return null;
    }

    return _computeMedian(historicalPrices);
  }

  getLastUpdateTime() {
    const lastUpdateTimes = this.priceFeeds.map(priceFeed => priceFeed.getLastUpdateTime());

    if (lastUpdateTimes.some(element => element === undefined || element === null)) {
      return null;
    }

    // Take the most recent update time.
    return Math.max(...lastUpdateTimes);
  }

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
