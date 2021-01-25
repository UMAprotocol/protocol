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
   * @param {Object?} denominatorPriceFeed We optionally divide the price spread between the spot and future baskets by this denominator price
   *      in order to "denominate" the basket spread price in a specified unit. For example, we might want to express the basket spread in terms
   *      of ETH-USD.
   * @param {Number} lowerBoundSpread lower bound that the resultant value can take on
   * @param {Number} upperBoundSpread upper bound that the resultant value can take on
   */
  constructor(web3, logger, spotPriceFeeds, futurePriceFeeds, denominatorPriceFeed, lowerBoundSpread, upperBoundSpread) {
    super();

    if (spotPriceFeeds.length === 0 || futurePriceFeeds.length === 0) {
      throw new Error("BasisPriceFeed cannot be constructed with empty spot or future baskets.");
    }

    this.spotPriceFeeds = spotPriceFeeds;
    this.futurePriceFeeds = futurePriceFeeds;
    this.denominatorPriceFeed = denominatorPriceFeed;

    this.lowerBoundSpread = lowerBoundSpread;
    this.upperBoundSpread = upperBoundSpread;

    // For convenience, concatenate all constituent price feeds.
    this.allPriceFeeds = this.spotPriceFeeds.concat(this.futurePriceFeeds);
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

  // Given lists of future and spot prices, and a denominator price,
  // return the spread price, which is:
  // (avg(future) - avg(spot) + 1) / denominator
  _getSpreadFromBasketPrices(futurePrices, spotPrices, denominatorPrice) {
    // Compute future basket mean.
    if (
      futurePrices.length === 0 ||
      futurePrices.some(element => element === undefined || element === null)
    ) {
      return null;
    }
    const futureMean = this._computeMean(futurePrices);

    // Second, compute the average of the spot pricefeeds.
    if (spotPrices.length === 0 || spotPrices.some(element => element === undefined || element === null)) {
      return null;
    }
    const spotMean = this._computeMean(spotPrices);

    if (!spotMean || !futureMean) return null;

    let spreadValue = futureMean.sub(spotMean).div(spotMean).mul(this.convertPriceFeedDecimals("100"));
    
    // Min + Max for clamping
    let lowerBound = this.toBN(this.lowerBoundSpread);
    let upperBound = this.toBN(this.upperBoundSpread);
    
    if (spreadValue.lt(lowerBound) {
      spreadValue = lowerBound;
    }
    else if (spreadValue.gt(upperBound) {
      spreadValue = upperBound;
    }
    return spreadValue;
  }

  getCurrentPrice() {
    const futurePrices = this.futurePriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    const spotPrices = this.spotPriceFeeds.map(priceFeed => priceFeed.getCurrentPrice());
    const denominatorPrice = this.denominatorPriceFeed && this.denominatorPriceFeed.getCurrentPrice();

    return this._getSpreadFromBasketPrices(futurePrices, spotPrices, denominatorPrice);
  }

  getHistoricalPrice(time) {
    const futurePrices = this.futurePriceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));
    const spotPrices = this.spotPriceFeeds.map(priceFeed => priceFeed.getHistoricalPrice(time));
    const denominatorPrice = this.denominatorPriceFeed && this.denominatorPriceFeed.getHistoricalPrice(time);

    return this._getSpreadFromBasketPrices(futurePrices, spotPrices, denominatorPrice);
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

