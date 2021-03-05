const assert = require("assert");
const { PriceFeedInterface } = require("./PriceFeedInterface");
const Web3 = require("web3");
const { create, all } = require("mathjs");

// Customize math (will be exported for other modules to use).
const math = create(all, { number: "BigNumber", precision: 100 });
const nativeIsAlpha = math.parse.isAlpha;
const allowedSpecialCharacters = Array.from("[]/ -");

// Modifies math.js's function to determine whether a character is allowed in a symbol name.
math.parse.isAlpha = function(c, cPrev, cNext) {
  // This character is the escape and the next is the special character.
  const isValidEscapeChar = c === "\\" && allowedSpecialCharacters.includes(cNext);

  // This character is the special character and the previous is the escape.
  const isSpecialChar = cPrev === "\\" && allowedSpecialCharacters.includes(c);

  return nativeIsAlpha(c, cPrev, cNext) || isValidEscapeChar || isSpecialChar;
};

// This escapes all the special characters (defined in the allowedSpecialCharacters array) in a string.
// For example (note that "\\" is the js representation for a single literal backslash)
// "ab/c d [e]" -> "ab\\/c\\ d\\[e\\]"
function escapeSpecialCharacters(input) {
  return Array.from(input)
    .map((char, index, array) => {
      if (allowedSpecialCharacters.includes(char) && array[index - 1] !== "\\") {
        return `\\${char}`;
      } else {
        return char;
      }
    })
    .join("");
}

// Allows users to combine other price feeds using "expressions" with the price feed identifiers being the symbols
// in these expressions. Ex: "USDETH * COMPUSD". Users can also comfigure custom price feeds in their configuration
// with custom symbols. Ex: "USDETH * COMPUSD * MY_CUSTOM_FEED".
class ExpressionPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs the DominationFinancePriceFeed.
   * @param {Object} priceFeedMap an object mapping from price feed names to the price feed objects.
   *                 Ex:
   *                 {
   *                   "USDETH": ETHBTC_PRICE_FEED_INSTANCE,
   *                   "COMPUSD": COMPUSD_PRICE_FEED_INSTANCE
   *                 }
   * @param {string} expression a string expression that uses price feeds in the priceFeedMap to compute a price.
   *                 Note: all symbols used in this expression must be defined in the price feed map.
   *                 Ex: "(USDETH + COMPUSD) / COMPUSD"
   * @param {number} decimals decimals to use in the price output.
   */
  constructor(priceFeedMap, expression, decimals = 18) {
    super();
    this.expressionCode = math.parse(expression).compile();
    this.priceFeedMap = priceFeedMap;
    this.decimals = decimals;
  }

  async getHistoricalPrice(time) {
    const historicalPrices = {};
    const errors = [];
    await Promise.all(
      Object.entries(this.priceFeedMap).map(async ([name, pf]) => {
        const price = await pf.getHistoricalPrice(time).catch(err => errors.push(err));
        historicalPrices[name] = this._convertToDecimal(price, pf.getPriceFeedDecimals());
      })
    );

    if (errors.length > 0) {
      throw errors;
    }

    return this._convertToFixed(this.expressionCode.evaluate(historicalPrices), this.getPriceFeedDecimals());
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
    Object.entries(this.priceFeedMap).map(([name, pf]) => {
      try {
        const price = pf.getCurrentPrice();
        assert(price !== undefined && price !== null, "Valid price must be returned");
        prices[name] = this._convertToDecimal(price, pf.getPriceFeedDecimals());
      } catch (err) {
        errors.push(err);
      }
    });

    if (errors.length > 0) return null;

    return this._convertToFixed(this.expressionCode.evaluate(prices), this.getPriceFeedDecimals());
  }

  getPriceFeedDecimals() {
    return this.decimals;
  }

  async update() {
    // Update all constituent price feeds.
    await Promise.all(Object.values(this.priceFeedMap).map(pf => pf.update()));
  }

  // Takes a BN fixed point number and converts it to a math.bignumber decimal number that the math library can handle.
  _convertToDecimal(price, inputDecimals) {
    const decimals = math.bignumber(inputDecimals);
    const decimalsMultiplier = math.bignumber(10).pow(decimals);
    return math.bignumber(price.toString()).div(decimalsMultiplier);
  }

  // Takes a math.bignumber OR math.ResultSet of math.bignumbers and converts it to a fixed point number that's
  // expected outside this library. Note: if the price is a ResultSet, the last value is converted and returned.
  _convertToFixed(price, outputDecimals) {
    // If the price is a ResultSet with multiple entires, extract the last one and make that the price.
    if (price.entries) {
      price = price.entries[price.entries.length - 1];
    }
    const decimals = math.bignumber(outputDecimals);
    const decimalsMultiplier = math.bignumber(10).pow(decimals);
    return Web3.utils.toBN(math.format(price.mul(decimalsMultiplier).round(), { notation: "fixed" }));
  }
}

module.exports = {
  ExpressionPriceFeed,
  math,
  allowedSpecialCharacters,
  escapeSpecialCharacters
};
