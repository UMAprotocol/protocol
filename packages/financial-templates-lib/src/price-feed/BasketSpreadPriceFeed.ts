import { PriceFeedInterface } from "./PriceFeedInterface";
import { parseFixed } from "@ethersproject/bignumber";
import assert from "assert";
import Web3 from "web3";
import type { Logger } from "winston";
import { BN, isDefined } from "../types";

type WithHistoricalPricePeriods<T> = T & { getHistoricalPricePeriods: () => [time: number, price: BN][] };

// An implementation of PriceFeedInterface that takes as input two sets ("baskets") of price feeds,
// computes the average price feed for each basket, and returns the spread between the two averages.
// !!Note: This PriceFeed assumes that the baselinePriceFeeds, experimentalPriceFeed, and denominatorPriceFeed
// are all returning prices in the same precision as `decimals`.
export class BasketSpreadPriceFeed extends PriceFeedInterface {
  private readonly toBN = Web3.utils.toBN;
  private readonly allPriceFeeds: PriceFeedInterface[];
  private readonly decimals: number;
  private readonly convertPriceFeedDecimals: (number: number | string) => BN;

  /**
   * @notice Constructs new BasketSpreadPriceFeed.
   * @param {Object} logger Winston module used to send logs.
   * @param {Object} web3 Provider from truffle instance to connect to Ethereum network.
   * @param {List} baselinePriceFeeds The baseline list of priceFeeds to compute the average of. All elements must be of type PriceFeedInterface.
   *      Must be an array of at least one element.
   * @param {List} experimentalPriceFeed The baseline list of priceFeeds to compute the average of. All elements must be of type PriceFeedInterface.
   *      Must be an array of at least one element.
   * @param {Object?} denominatorPriceFeed We optionally divide the price spread between the baseline and experimental baskets by this denominator price
   *      in order to "denominate" the basket spread price in a specified unit. For example, we might want to express the basket spread in terms
   *      of ETH-USD.
   */
  constructor(
    public readonly web3: Web3,
    private readonly logger: Logger,
    private readonly baselinePriceFeeds: PriceFeedInterface[],
    private readonly experimentalPriceFeeds: PriceFeedInterface[],
    private readonly denominatorPriceFeed?: PriceFeedInterface
  ) {
    super();

    if (baselinePriceFeeds.length === 0 || experimentalPriceFeeds.length === 0) {
      throw new Error("BasketSpreadPriceFeed cannot be constructed with empty baseline or experimental baskets.");
    }

    // For convenience, concatenate all constituent price feeds.
    this.allPriceFeeds = this.baselinePriceFeeds.concat(this.experimentalPriceFeeds);
    if (this.denominatorPriceFeed) {
      this.allPriceFeeds = this.allPriceFeeds.concat(this.denominatorPriceFeed);
    }

    // The precision that the user wants to return prices in must match all basket constituent price feeds and the denominator.
    const decimals = this.allPriceFeeds[0].getPriceFeedDecimals();
    if (decimals === null) throw new Error(`BasketSpreadPriceFeed -- first price feed has null decimals`);
    this.decimals = decimals;

    // Scale `number` by 10**decimals.
    this.convertPriceFeedDecimals = (number: number | string) => {
      // Converts price result to wei
      // returns price conversion to correct decimals as a big number
      return this.toBN(parseFixed(number.toString(), this.decimals).toString());
    };
  }

  // Given lists of experimental and baseline prices, and a denominator price,
  // return the spread price, which is:
  // (avg(experimental) - avg(baseline) + 1) / denominator
  private _getSpreadFromBasketPrices(
    experimentalPrices: (BN | null)[],
    baselinePrices: (BN | null)[],
    denominatorPrice?: BN | null
  ): BN {
    // Compute experimental basket mean.
    if (experimentalPrices.length === 0 || !experimentalPrices.every(isDefined)) {
      throw new Error("BasketSpreadPriceFeed: Missing unknown experimental basket price");
    }
    const experimentalMean = this._computeMean(experimentalPrices);

    // Second, compute the average of the baseline pricefeeds.
    if (baselinePrices.length === 0 || !baselinePrices.every(isDefined)) {
      throw new Error("BasketSpreadPriceFeed: Missing unknown baseline basket price");
    }
    const baselineMean = this._computeMean(baselinePrices);

    // All calculations within this if statement will produce unexpected results if any of the
    // experimental mean, baseline mean, or denominator price are NOT in the same precision as
    // the one that this.convertPriceFeedDecimals() uses.
    if (!baselineMean || !experimentalMean)
      throw new Error("BasketSpreadPriceFeed: missing baselineMean or experimentalMean");

    // TODO: Parameterize the lower (0) and upper (2) bounds, as well as allow for custom "spreadValue" formulas,
    // for example we might not want to have the spread centered around 1, like it is here:
    let spreadValue = experimentalMean.sub(baselineMean).add(this.convertPriceFeedDecimals("1"));

    // Ensure non-negativity
    if (spreadValue.lt(this.toBN("0"))) {
      spreadValue = this.toBN("0");
    }
    // Ensure symmetry
    else if (spreadValue.gt(this.convertPriceFeedDecimals("2"))) {
      spreadValue = this.convertPriceFeedDecimals("2");
    }

    // Optionally divide by denominator pricefeed.
    if (!denominatorPrice) return spreadValue;
    spreadValue = spreadValue.mul(this.convertPriceFeedDecimals("1")).div(denominatorPrice);

    return spreadValue;
  }

  public getCurrentPrice(): BN | null {
    const experimentalPrices = this.experimentalPriceFeeds.map((priceFeed) => priceFeed.getCurrentPrice());
    const baselinePrices = this.baselinePriceFeeds.map((priceFeed) => priceFeed.getCurrentPrice());
    const denominatorPrice = this.denominatorPriceFeed && this.denominatorPriceFeed.getCurrentPrice();

    try {
      return this._getSpreadFromBasketPrices(experimentalPrices, baselinePrices, denominatorPrice);
    } catch (err) {
      return null;
    }
  }

  public async getHistoricalPrice(time: number, ancillaryData: string, verbose = false): Promise<BN | null> {
    // If failure to fetch any constituent historical prices, then throw
    // array of errors.
    const errors: any[] = [];
    const experimentalPrices = await Promise.all(
      this.experimentalPriceFeeds.map((priceFeed) => {
        return priceFeed.getHistoricalPrice(time, ancillaryData, verbose).catch((err) => {
          errors.push(err);
          return null;
        });
      })
    );
    const baselinePrices = await Promise.all(
      this.baselinePriceFeeds.map((priceFeed) => {
        return priceFeed.getHistoricalPrice(time, ancillaryData, verbose).catch((err) => {
          errors.push(err);
          return null;
        });
      })
    );
    let denominatorPrice;
    if (this.denominatorPriceFeed) {
      denominatorPrice = await this.denominatorPriceFeed
        .getHistoricalPrice(time, ancillaryData, verbose)
        .catch((err) => {
          errors.push(err);
          return null;
        });
    }

    if (errors.length > 0) {
      throw errors;
    } else {
      return this._getSpreadFromBasketPrices(experimentalPrices, baselinePrices, denominatorPrice);
    }
  }
  // This searches for closest time in a list of [[time,price]] data. Based on code in affiliates models/prices.
  // input list is [[time,price]]
  // output price as BN
  public closestTime(list: [time: number, price: string | number | BN][]): (time: number) => BN {
    return (time: number) => {
      const result = list.reduce((a, b) => {
        const aDiff = Math.abs(a[0] - time);
        const bDiff = Math.abs(b[0] - time);

        // if differences are equal, return larger? timestamp
        if (aDiff == bDiff) {
          return a < b ? a : b;
        }
        // if diffs are diff, return smallest diff
        return bDiff < aDiff ? b : a;
      });
      assert(result, "no closest time found");
      return this.toBN(result[1].toString());
    };
  }
  // This function does something similar to get historicalprice, but does not have the luxury of only caring about a
  // single point in time. It has to run the basketspread price across all timestamps available. This is complicated
  // as there are multiple price histories which we must search through at each matching timestamp to find the closets
  // prices to add into the basket calculation.
  // Returns data in the form of [[time,price]]
  public getHistoricalPricePeriods(): (number | BN)[][] {
    type AugmentedInterface = WithHistoricalPricePeriods<PriceFeedInterface>;
    const experimentalPriceFeeds = this.experimentalPriceFeeds as AugmentedInterface[];
    const baselinePriceFeeds = this.baselinePriceFeeds as AugmentedInterface[];
    const denominatorPriceFeed = this.denominatorPriceFeed as AugmentedInterface | undefined;
    const experimentalPrices = experimentalPriceFeeds.map((priceFeed) => {
      // This price history gets wrapped in "closestTime" which returns a searching function with timestamp input.
      return this.closestTime(priceFeed.getHistoricalPricePeriods());
    });
    const baselinePrices = baselinePriceFeeds.map((priceFeed) => {
      return this.closestTime(priceFeed.getHistoricalPricePeriods());
    });
    let denominatorPrice: undefined | ((time: number) => BN);
    if (denominatorPriceFeed) {
      denominatorPrice = this.closestTime(denominatorPriceFeed.getHistoricalPricePeriods());
    }

    // This uses the first baseline price feed as a reference for the historical timestamps to search for
    const pricePeriods = baselinePriceFeeds[0].getHistoricalPricePeriods();
    return pricePeriods.map((pricePeriod) => {
      const [time] = pricePeriod;
      // Each parameter looks up and returns the closest price to the timestamp.
      const expPrices = experimentalPrices.map((lookup) => lookup(time));
      const basePrices = baselinePrices.map((lookup) => lookup(time));
      const denomPrices = denominatorPrice ? denominatorPrice(time) : null;

      // Takes in an array of prices for each basket and returns a single price
      return [time, this._getSpreadFromBasketPrices(expPrices, basePrices, denomPrices)];
    });
  }
  // Gets the *most recent* update time for all constituent price feeds.
  public getLastUpdateTime(): number | null {
    const lastUpdateTimes = this.allPriceFeeds.map((priceFeed) => priceFeed.getLastUpdateTime());
    if (!lastUpdateTimes.every(isDefined)) {
      return null;
    }

    // Take the most recent update time.
    return Math.max(...lastUpdateTimes);
  }

  // Returns the shortest lookback window of the constituent price feeds.
  public getLookback(): number | null {
    const lookbacks = this.allPriceFeeds.map((priceFeed) => priceFeed.getLookback());
    if (!lookbacks.every(isDefined)) {
      return null;
    }
    return Math.min(...lookbacks);
  }

  public getPriceFeedDecimals(): number {
    // Check that every price feeds decimals are the same.
    const priceFeedDecimals = this.allPriceFeeds.map((priceFeed) => priceFeed.getPriceFeedDecimals());
    if (!priceFeedDecimals.every((feedDecimals) => feedDecimals === this.decimals)) {
      throw new Error("BasketPriceFeed's constituent feeds do not all match the denominator price feed's precision!");
    }

    return this.decimals;
  }

  // Updates all constituent price feeds.
  public async update(): Promise<void> {
    await Promise.all(this.allPriceFeeds.map((priceFeed) => priceFeed.update()));
  }

  // Inputs are expected to be BNs.
  private _computeMean(inputs: BN[]): BN {
    let sum = this.toBN("0");

    for (const priceBN of inputs) {
      sum = sum.add(priceBN);
    }

    return sum.divn(inputs.length);
  }
}
