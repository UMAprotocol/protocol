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
  ExpressionPriceFeed,
  math,
  allowedSpecialCharacters,
  escapeSpecialCharacters
};
