import { PriceFeedInterface } from "./PriceFeedInterface";
import Web3 from "web3";
import { BN, isDefined } from "../types";

type WithHistoricalPricePeriods<T> = T & { getHistoricalPricePeriods: () => [number, BN | null][] };

// An implementation of PriceFeedInterface that medianizes other price feeds.
export class MedianizerPriceFeed extends PriceFeedInterface {
  private readonly toBN = Web3.utils.toBN;
  /**
   * @notice Constructs new MedianizerPriceFeed.
   * @param {List} priceFeeds a list of priceFeeds to medianize. All elements must be of type PriceFeedInterface.
   *      Must be an array of at least one element.
   * @param {Boolean=false} computeMean Set this to true to return the mean over price feeds instead of the median.
   *      Default behavior is to return median.
   */
  constructor(private readonly priceFeeds: PriceFeedInterface[], private readonly computeMean = false) {
    super();

    if (priceFeeds.length === 0) {
      throw new Error("MedianizerPriceFeed cannot be constructed with no constituent price feeds.");
    }
  }

  // Takes the median of all of the constituent price feeds' currentPrices.
  public getCurrentPrice(): BN | null {
    const currentPrices = this.priceFeeds.map((priceFeed) => priceFeed.getCurrentPrice());
    if (!currentPrices.every(isDefined)) {
      return null;
    }

    if (this.computeMean) {
      return this._computeMean(currentPrices);
    } else {
      return this._computeMedian(currentPrices);
    }
  }

  // Takes the median of all of the constituent price feeds' historical prices.
  public async getHistoricalPrice(time: number, ancillaryData: string, verbose = false): Promise<BN> {
    // If failure to fetch any constituent historical prices, then throw
    // array of errors.
    const errors: any[] = [];
    const historicalPrices = await Promise.all(
      this.priceFeeds.map((priceFeed) => {
        return priceFeed
          .getHistoricalPrice(time, ancillaryData, verbose)
          .then((result) => {
            if (!result) throw new Error(`null return value`);
            return result;
          })
          .catch((err) => {
            errors.push(err);
            return this.toBN(0); // Placeholder since the error will get thrown anyway.
          });
      })
    );

    if (errors.length > 0) {
      throw errors;
    } else {
      if (this.computeMean) {
        return this._computeMean(historicalPrices);
      } else {
        return this._computeMedian(historicalPrices);
      }
    }
  }

  // Note: This method will fail if one of the pricefeeds has not implemented `getHistoricalPricePeriods`, which
  // is basically every price feed except for the CryptoWatchPriceFeed.
  public getHistoricalPricePeriods(): [number, string][] {
    // Fetch all historical price data for all price feeds within the medianizer set.
    const priceFeeds = this.priceFeeds as WithHistoricalPricePeriods<PriceFeedInterface>[];
    const historicalPricePeriods = priceFeeds.map((priceFeed) => priceFeed.getHistoricalPricePeriods());

    const processedMedianHistoricalPricePeriods: [number, string][] = [];

    // For each discrete point in time within the set of price feeds iterate over and compute the median.
    for (let pricePointIndex = 0; pricePointIndex < historicalPricePeriods[0].length; pricePointIndex++) {
      // Create an array of prices at the pricePointIndex for each price feed. The median is taken over this set.
      const periodPrices = historicalPricePeriods.map((historicalPrice) => {
        const pricePoint = historicalPrice?.[pricePointIndex]?.[1] || null;
        // this is meant to process historicalPrices in the form of [timestamp,price]. Some older price feeds may
        // not conform to this, as this api has changed recently, though the medianizer has always conformed to this.
        // TODO: updated any non conforming price feeds to return getHistoricalPricePeriods as an array of [time,price].
        return pricePoint ? this.toBN(pricePoint.toString()) : this.toBN("0");
      });
      processedMedianHistoricalPricePeriods[pricePointIndex] = [
        historicalPricePeriods[0][pricePointIndex][0],
        this.computeMean ? this._computeMean(periodPrices).toString() : this._computeMedian(periodPrices).toString(),
      ];
    }
    return processedMedianHistoricalPricePeriods;
  }

  // Gets the *most recent* update time for all constituent price feeds.
  public getLastUpdateTime(): number | null {
    const lastUpdateTimes = this.priceFeeds.map((priceFeed) => priceFeed.getLastUpdateTime());

    if (!lastUpdateTimes.every(isDefined)) {
      return null;
    }

    // Take the most recent update time.
    return Math.max(...lastUpdateTimes);
  }

  // Gets the decimals of the medianized price feeds. Errors out if any price feed had a different number of decimals.
  public getPriceFeedDecimals(): number {
    const priceFeedDecimals = this.priceFeeds.map((priceFeed) => priceFeed.getPriceFeedDecimals());
    // Check that every price feeds decimals match the 0th price feeds decimals.
    if (!priceFeedDecimals[0] || !priceFeedDecimals.every((feedDecimals) => feedDecimals === priceFeedDecimals[0])) {
      throw new Error("MedianizerPriceFeed's feeds do not all have the same decimals or invalid decimals!");
    }

    return priceFeedDecimals[0];
  }

  // Returns the shortest lookback window of the constituent price feeds.
  public getLookback(): number | null {
    const lookbacks = this.priceFeeds.map((priceFeed) => priceFeed.getLookback());
    if (!lookbacks.every(isDefined)) {
      return null;
    }
    return Math.min(...lookbacks);
  }

  // Updates all constituent price feeds.
  public async update(): Promise<void> {
    await Promise.all(this.priceFeeds.map((priceFeed) => priceFeed.update()));
  }

  // Inputs are expected to be BNs.
  private _computeMedian(inputs: BN[]) {
    inputs.sort((a, b) => a.cmp(b));

    // Compute midpoint (top index / 2).
    const maxIndex = inputs.length - 1;
    const midpoint = maxIndex / 2;

    // If the count is odd, the midpoint will land on a whole number, taking an average of the same number.
    // If the count is even, the midpoint will land on X.5, averaging the index below and above.
    return inputs[Math.floor(midpoint)].add(inputs[Math.ceil(midpoint)]).divn(2);
  }
  private _computeMean(inputs: BN[]): BN {
    let sum = null;

    for (const priceBN of inputs) {
      if (sum === null) {
        sum = priceBN;
      } else {
        sum = sum.add(priceBN);
      }
    }
    if (sum === null) throw new Error("inputs is empty!");

    return sum.divn(inputs.length);
  }
}
