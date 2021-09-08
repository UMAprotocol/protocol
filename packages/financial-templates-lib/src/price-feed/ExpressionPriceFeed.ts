import assert from "assert";
import { PriceFeedInterface } from "./PriceFeedInterface";
import Web3 from "web3";
import { create, all, MathJsStatic } from "mathjs";
import { BN, isDefined } from "../types";

// Customize math (will be exported for other modules to use).
export const math = create(all, { number: "BigNumber", precision: 100 }) as MathJsStatic; // Assumes all fields are returned.
const nativeIsAlpha = math.parse.isAlpha;
const allowedSpecialCharacters = Array.from("[]/ -");

// Modifies math.js's function to determine whether a character is allowed in a symbol name.
math.parse.isAlpha = function (c, cPrev, cNext) {
  // This character is the escape and the next is the special character.
  const isValidEscapeChar = c === "\\" && allowedSpecialCharacters.includes(cNext);

  // This character is the special character and the previous is the escape.
  const isSpecialChar = cPrev === "\\" && allowedSpecialCharacters.includes(c);

  return nativeIsAlpha(c, cPrev, cNext) || isValidEscapeChar || isSpecialChar;
};

// This escapes all the special characters (defined in the allowedSpecialCharacters array) in a string.
// For example (note that "\\" is the js representation for a single literal backslash)
// "ab/c d [e]" -> "ab\\/c\\ d\\[e\\]"
export function escapeSpecialCharacters(input: string): string {
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

interface ResultSet<T> {
  entries: T[];
}

// Allows users to combine other price feeds using "expressions" with the price feed identifiers being the symbols
// in these expressions. Ex: "USDETH * COMPUSD". Users can also comfigure custom price feeds in their configuration
// with custom symbols. Ex: "USDETH * COMPUSD * MY_CUSTOM_FEED".
export class ExpressionPriceFeed extends PriceFeedInterface {
  private readonly expressionCode: math.EvalFunction;

  /**
   * @notice Constructs the ExpressionPriceFeed.
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
  constructor(
    private readonly priceFeedMap: { [name: string]: PriceFeedInterface },
    expression: string,
    private readonly decimals = 18
  ) {
    super();
    this.expressionCode = math.parse(expression).compile();
    this.priceFeedMap = priceFeedMap;
    this.decimals = decimals;
  }

  public async getHistoricalPrice(time: number | string, ancillaryData: string, verbose = false): Promise<BN> {
    const historicalPrices: { [name: string]: math.BigNumber } = {};
    const errors: any[] = [];
    await Promise.all(
      Object.entries(this.priceFeedMap).map(async ([name, pf]) => {
        const price = await pf
          .getHistoricalPrice(Number(time), ancillaryData, verbose)
          .then((value) => {
            if (!value) throw new Error(`Price feed ${name} returned null when calling getHistoricalPrice`);
            return value;
          })
          .catch((err) => {
            errors.push(err);
            return Web3.utils.toBN(0); // Just return 0 since this will be ignored anyway.
          });
        historicalPrices[name] = this._convertToDecimal(price, pf.getPriceFeedDecimals() || 18);
      })
    );

    if (errors.length > 0) {
      throw errors;
    }

    return this._convertToFixed(this.expressionCode.evaluate(historicalPrices), this.getPriceFeedDecimals());
  }

  public getLastUpdateTime(): number | null {
    const lastUpdateTimes = Object.values(this.priceFeedMap).map((pf) => pf.getLastUpdateTime());

    // If any constituents returned an invalid value, bubble it up.
    if (!lastUpdateTimes.every(isDefined)) {
      return null;
    }

    // Take the max.
    return Math.max(...lastUpdateTimes);
  }

  public getLookback(): number | null {
    const lookbacks = Object.values(this.priceFeedMap).map((priceFeed) => priceFeed.getLookback());

    // If any constituents returned an invalid value, bubble it up.
    if (!lookbacks.every(isDefined)) {
      return null;
    }

    // Take the min since the overall lookback will be the min.
    return Math.min(...lookbacks);
  }

  public getCurrentPrice(): BN | null {
    const prices: { [name: string]: math.BigNumber } = {};
    const errors = [];
    Object.entries(this.priceFeedMap).map(([name, pf]) => {
      try {
        const price = pf.getCurrentPrice();
        const decimals = pf.getPriceFeedDecimals();
        assert(price !== undefined && price !== null, "Valid price must be returned");
        assert(decimals !== null, "Valid decimals must be returned");
        prices[name] = this._convertToDecimal(price, decimals);
      } catch (err) {
        errors.push(err);
      }
    });

    if (errors.length > 0) return null;

    return this._convertToFixed(this.expressionCode.evaluate(prices), this.getPriceFeedDecimals());
  }

  public getPriceFeedDecimals(): number {
    return this.decimals;
  }

  public async update(): Promise<void> {
    // Update all constituent price feeds.
    await Promise.all(Object.values(this.priceFeedMap).map((pf) => pf.update()));
  }

  // Takes a BN fixed point number and converts it to a math.bignumber decimal number that the math library can handle.
  private _convertToDecimal(price: BN, inputDecimals: number): math.BigNumber {
    const decimals = math.bignumber(inputDecimals);
    const decimalsMultiplier = math.bignumber(10).pow(decimals);

    return math.bignumber(price.toString()).div(decimalsMultiplier);
  }

  // Takes a math.bignumber OR math.ResultSet of math.bignumbers and converts it to a fixed point number that's
  // expected outside this library. Note: if the price is a ResultSet, the last value is converted and returned.
  private _convertToFixed(price: math.BigNumber | ResultSet<math.BigNumber>, outputDecimals: number): BN {
    // If the price is a ResultSet with multiple entires, extract the last one and make that the price.
    if ("entries" in price) {
      price = price.entries[price.entries.length - 1];
    }
    const decimals = math.bignumber(outputDecimals);
    const decimalsMultiplier = math.bignumber(10).pow(decimals);
    return Web3.utils.toBN(math.format(price.mul(decimalsMultiplier).round(), { notation: "fixed" }));
  }
}
