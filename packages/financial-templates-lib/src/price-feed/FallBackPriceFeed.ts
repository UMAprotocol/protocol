import { PriceFeedInterface } from "./PriceFeedInterface";
import { BN, isDefined } from "../types";

// An implementation of PriceFeedInterface that provides an order pricefeeds to fall back to
// if the higher-priority ones fail for any reason.
export class FallBackPriceFeed extends PriceFeedInterface {
  /**
   * @notice Constructs new FallBackPriceFeed.
   * @param {List} orderedPriceFeeds an ordered list of priceFeeds to fallback through.
   *      All elements must be of type PriceFeedInterface. Pricefeeds fall back from beginning of the array to the end.
   *      Must be an array of at least one element.
   */
  constructor(private readonly priceFeeds: PriceFeedInterface[]) {
    super();

    if (priceFeeds.length === 0) {
      throw new Error("FallBackPriceFeed cannot be constructed with no constituent price feeds.");
    }
  }

  // Return first successfully fetched price or throw an error if they all fail.
  public getCurrentPrice(): BN | null {
    for (const _priceFeed of this.priceFeeds) {
      const price = _priceFeed.getCurrentPrice();
      if (!price) continue;
      return price;
    }

    // If no pricefeeds return successfully, indicate failure.
    return null;
  }

  public async getHistoricalPrice(time: number, ancillaryData: string, verbose = false): Promise<BN> {
    // If failure to fetch any constituent historical prices, then throw
    // array of errors.
    const errors = [];
    for (const _priceFeed of this.priceFeeds) {
      try {
        const price = await _priceFeed.getHistoricalPrice(time, ancillaryData, verbose);
        if (!price)
          throw new Error(
            `Feed at index ${this.priceFeeds.findIndex(
              (feed) => feed === _priceFeed
            )} returned null for historical price query.`
          );
        return price;
      } catch (err) {
        errors.push(err);
        continue;
      }
    }

    throw errors;
  }

  // Note: This method will fail if one of the pricefeeds has not implemented `getHistoricalPricePeriods`, which
  // is basically every price feed except for the CryptoWatchPriceFeed.
  public getHistoricalPricePeriods(): [number, BN | null][] {
    throw new Error("getHistoricalPricePeriods Unimplemented for FallBackPriceFeed");
  }

  // Gets the *most recent* update time for all constituent price feeds.
  public getLastUpdateTime(): number | null {
    // Filter out missing update times:
    const lastUpdateTimes = this.priceFeeds.map((priceFeed) => priceFeed.getLastUpdateTime()).filter(isDefined);

    if (lastUpdateTimes.length > 0) {
      // Take the most recent update time.
      return Math.max(...lastUpdateTimes);
    } else {
      return null;
    }
  }

  // Return the longest lookback within all the fallback feeds.
  public getLookback(): number | null {
    const lookbacks = this.priceFeeds.map((feed) => feed.getLookback()).filter(isDefined);
    if (lookbacks.length === 0) return null;
    return Math.max(...lookbacks);
  }

  // Errors out if any price feed had a different number of decimals.
  getPriceFeedDecimals(): number {
    const priceFeedDecimals = this.priceFeeds.map((priceFeed) => priceFeed.getPriceFeedDecimals());
    // Check that every price feeds decimals match the 0th price feeds decimals.
    const firstDecimals = priceFeedDecimals[0];
    if (
      !isDefined(firstDecimals) ||
      !priceFeedDecimals.every((feedDecimals) => feedDecimals === priceFeedDecimals[0])
    ) {
      throw new Error("FallBackPriceFeed's feeds do not all have the same decimals or invalid decimals!");
    }

    return firstDecimals;
  }

  // Updates all constituent price feeds, but ignore errors since some might fail without
  // causing this pricefeed's getPrice methods to fail. Only throw an error
  // if all updates fail.
  public async update(): Promise<void> {
    const errors: any[] = [];
    // allSettled() does not short-circuit if any promises reject, instead it returns
    // an array of ["fulfilled", "rejected"] statuses.
    const results = await Promise.allSettled(this.priceFeeds.map((priceFeed) => priceFeed.update()));

    // Filter out rejected updates:
    results.map((result) => {
      if (result.status === "rejected") {
        errors.push(new Error(result.reason));
      }
    });

    // If every update failed, then throw the errors:
    if (errors.length === this.priceFeeds.length) throw errors;
  }
}
