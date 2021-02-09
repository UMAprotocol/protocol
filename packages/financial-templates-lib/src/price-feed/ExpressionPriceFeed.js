const assert = require("assert");
const { PriceFeedInterface } = require("./PriceFeedInterface");
const Web3 = require("web3");
const { create, all } = require("mathjs");
const math = create(all, { number: "BigNumber", precision: 100 });

// Gets balancer spot and historical prices. This price feed assumes that it is returning
// prices as 18 decimals of precision, so it will scale up the pool's price as reported by Balancer contracts
// if the user specifies that the Balancer contract is returning non-18 decimal precision prices.
class ExpressionPriceFeed extends PriceFeedInterface {
  constructor(priceFeedMap, expression) {
    super();
    this.expressionCode = math.parse(expression).compile();
    this.priceFeedMap = priceFeedMap;
  }

  async getHistoricalPrice(time) {
    const historicalPrices = {};
    const errors = [];
    await Promise.all(
      Object.entries(this.priceFeedMap).map(async ([name, pf]) => {
        const price = await pf.getHistoricalPrice(time).catch(err => errors.push(err));
        historicalPrices[name] = this._convertToDecimal(price);
      })
    );

    if (errors.length > 0) {
      throw errors;
    }

    return this._convertToFixed(this.expressionCode.evaluate(historicalPrices));
  }

  getLastUpdateTime() {
    const lastUpdateTimes = Object.values(this.priceFeedMap).map(pf => pf.getLastUpdateTime());

    // If any constituents returned an invalid value, bubble it up.
    if (lastUpdateTimes.some(time => time === null || time === undefined)) {
      return null;
    }

    // Take the max.
    return Math.max(...lastUpdateTimes);
  }

  getLookback() {
    const lookbacks = Object.values(this.priceFeedMap).map(priceFeed => priceFeed.getLookback());

    // If any constituents returned an invalid value, bubble it up.
    if (lookbacks.some(lookback => lookback === undefined || lookback === null)) {
      return null;
    }

    // Take the min since the overall lookback will be the min.
    return Math.min(...lookbacks);
  }

  getCurrentPrice() {
    const prices = {};
    const errors = [];
    Object.entries(this.priceFeedMap).map(async ([name, pf]) => {
      try {
        const price = pf.getCurrentPrice();
        assert(price !== undefined && price !== null, "Valid price must be returned");
        prices[name] = this._convertToDecimal(price);
      } catch (err) {
        errors.push(err);
      }
    });

    if (errors.length > 0) return null;

    return this._convertToFixed(this.expressionCode.evaluate(prices));
  }

  getPriceFeedDecimals() {
    const decimalArray = Object.values(this.priceFeedMap).map(pf => pf.getPriceFeedDecimals());
    const decimalsValue = decimalArray[0];
    assert(decimalsValue, "Invalid decimals value");
    assert(
      decimalArray.every(decimals => decimals === decimalsValue),
      "Constituent price feeds do not have matching decimals"
    );
    return decimalsValue;
  }

  async update() {
    // Update all constituent price feeds.
    await Promise.all(Object.values(this.priceFeedMap).map(pf => pf.update()));
  }

  // Takes a BN fixed point number and converts it to a math.bignumber decimal number that the math library can handle.
  _convertToDecimal(price) {
    const decimals = math.bignumber(this.getPriceFeedDecimals());
    const decimalsMultiplier = math.bignumber(10).pow(decimals);
    return math.bignumber(price.toString()).div(decimalsMultiplier);
  }

  // Takes a math.bignumber number and converts it to a fixed point number that's expected outside this library.
  _convertToFixed(price) {
    const decimals = math.bignumber(this.getPriceFeedDecimals());
    const decimalsMultiplier = math.bignumber(10).pow(decimals);
    return Web3.utils.toBN(
      price
        .mul(decimalsMultiplier)
        .round()
        .toString()
    );
  }
}

module.exports = {
  ExpressionPriceFeed
};
