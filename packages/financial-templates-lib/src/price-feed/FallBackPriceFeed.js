const { PriceFeedInterface } = require("./PriceFeedInterface");

// An implementation of PriceFeedInterface that provides an order pricefeeds to fall back to
// if the higher-priority ones fail for any reason.
class FallBackPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new FallBackPriceFeed.
   * @param {List} orderedPriceFeeds an ordered list of priceFeeds to fallback through.
   *      All elements must be of type PriceFeedInterface. Pricefeeds fall back from beginning of the array to the end.
   *      Must be an array of at least one element.
   */
  constructor(orderedPriceFeeds) {
    super();

    if (orderedPriceFeeds.length === 0) {
      throw new Error("FallBackPriceFeed cannot be constructed with no constituent price feeds.");
    }

    this.priceFeeds = orderedPriceFeeds;
  }

  // Return first successfully fetched price or throw an error if they all fail.
  getCurrentPrice() {
    for (let _priceFeed of this.priceFeeds) {
      const price = _priceFeed.getCurrentPrice();
      if (!price) continue;
      return price;
    }

    // If no pricefeeds return successfully, indicate failure.
    return null;
  }

  async getHistoricalPrice(time, verbose = false) {
    // If failure to fetch any constituent historical prices, then throw
    // array of errors.
    let errors = [];
    for (let _priceFeed of this.priceFeeds) {
      try {
        return await _priceFeed.getHistoricalPrice(time, verbose);
      } catch (err) {
        errors.push(err);
        continue;
      }
    }

    throw errors;
  }

  // Note: This method will fail if one of the pricefeeds has not implemented `getHistoricalPricePeriods`, which
  // is basically every price feed except for the CryptoWatchPriceFeed.
  getHistoricalPricePeriods() {
    throw new Error("getHistoricalPricePeriods Unimplemented for FallBackPriceFeed");
  }

  // Gets the update time for the first pricefeed that successfully updated.
  getLastUpdateTime() {
    for (let _priceFeed of this.priceFeeds) {
      const lastUpdateTime = _priceFeed.getLastUpdateTime();
      if (!lastUpdateTime) continue;
      return lastUpdateTime;
    }

    // If no pricefeeds return successfully, indicate failure.
    return null;
  }

  // Errors out if any price feed had a different number of decimals.
  getPriceFeedDecimals() {
    const priceFeedDecimals = this.priceFeeds.map(priceFeed => priceFeed.getPriceFeedDecimals());
    // Check that every price feeds decimals match the 0th price feeds decimals.
    if (!priceFeedDecimals[0] || !priceFeedDecimals.every(feedDecimals => feedDecimals === priceFeedDecimals[0])) {
      throw new Error("FallBackPriceFeed's feeds do not all have the same decimals or invalid decimals!");
    }

    return priceFeedDecimals[0];
  }

  // Try to update constituent pricefeeds until one succeeds.
  async update() {
    // If failure to update any constituent feeds, then throw
    // array of errors.
    let errors = [];
    for (let _priceFeed of this.priceFeeds) {
      try {
        return await _priceFeed.update();
      } catch (err) {
        errors.push(err);
        continue;
      }
    }

    throw errors;
  }
}

module.exports = {
  FallBackPriceFeed
};
