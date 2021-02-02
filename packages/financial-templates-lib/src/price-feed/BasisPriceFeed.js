const { PriceFeedInterface } = require("./PriceFeedInterface");
const { parseFixed } = require("@ethersproject/bignumber");

class BasisPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new BasisPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {List} spotPriceFeeds The spot list of priceFeeds to compute the average of. All elements must be of type PriceFeedInterface.
   *      Must be an array of at least one element.
   * @param {List} futurePriceFeed The spot list of priceFeeds to compute the average of. All elements must be of type PriceFeedInterface.
   *      Must be an array of at least one element.
   * @param {Number} lowerBound lower bound that the resultant value can take on
   * @param {Number} upperBound upper bound that the resultant value can take on
   */
  constructor(
    web3,
    logger,
    spotPriceFeeds,
    futurePriceFeeds,
    lowerBound,
    upperBound
  ) {
    super();

    if (spotPriceFeeds.length === 0 || futurePriceFeeds.length === 0) {
      throw new Error("BasisPriceFeed cannot be constructed with empty spot or future baskets.");
    }

    this.spotPriceFeeds = spotPriceFeeds;
    this.futurePriceFeeds = futurePriceFeeds;

    this.lowerBound = lowerBound;
    this.upperBound = upperBound;

    // For convenience, concatenate all constituent price feeds.
    this.allPriceFeeds = this.spotPriceFeeds.concat(this.futurePriceFeeds);

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

  // Given lists of future and spot prices
  // return the spread price, which is:
  // 100 ((avg(future) - avg(spot))/(avg(spot)) + 1)
  _getSpreadFromBasketPrices(futurePrices, spotPrices) {
    // Compute future basket mean.
    if (futurePrices.length === 0 || futurePrices.some(element => element === undefined || element === null)) {
      return null;
    }
    const futureMean = this._computeMean(futurePrices);

    // Second, compute the average of the spot pricefeeds.
    if (spotPrices.length === 0 || spotPrices.some(element => element === undefined || element === null)) {
      return null;
    }
    const spotMean = this._computeMean(spotPrices);

    if (!spotMean || !futureMean) return null;

    if (spotMean.eq(this.toBN("0"))) return this.convertPriceFeedDecimals("100");

    let spreadValue = (((futureMean.sub(spotMean)/spotMean) + 1) * 100).toFixed(this.decimals);

    spreadValue = this.convertPriceFeedDecimals(spreadValue);

    // Min + Max for clamping
    let lowerBound = this.convertPriceFeedDecimals(this.lowerBound);
    let upperBound = this.convertPriceFeedDecimals(this.upperBound);

    if (spreadValue.lt(lowerBound)) {
      spreadValue = lowerBound;
    } else if (spreadValue.gt(upperBound)) {
      spreadValue = upperBound;
    }
    return spreadValue;
  }

  getCurrentPrice() {
    const futurePrices = this.futurePriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    const spotPrices = this.spotPriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());

    return this._getSpreadFromBasketPrices(futurePrices, spotPrices);
  }

  getHistoricalPrice(time) {
    const futurePrices = this.futurePriceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));
    const spotPrices = this.spotPriceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));

    return this._getSpreadFromBasketPrices(futurePrices, spotPrices);
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
  BasisPriceFeed
};
