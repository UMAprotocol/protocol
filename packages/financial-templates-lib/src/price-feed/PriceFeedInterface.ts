import { BN } from "../types";

// Price feed interface -- all price feed implementations should override all functions (except for _abstractFunctionCalled).
export abstract class PriceFeedInterface {
  // Updates the internal state of the price feed. Should pull in any async data so the get*Price methods can be called.
  // Will use the optional ancillary data parameter to customize what kind of data get*Price returns.
  // Note: derived classes *must* override this method.
  // Note: Eventually `update` will be removed in favor of folding its logic into `getCurrentPrice`.
  public abstract update(ancillaryData?: string): Promise<void>;

  // Gets the current price (as a BN) for this feed synchronously from the in-memory state of this price feed object.
  // This price should be up-to-date as of the last time that `update(ancillaryData)` was called, using any parameters
  // specified in the ancillary data passed as input. If `update()` has never been called, this should return `null` or
  // `undefined`. If no price could be retrieved, it should return `null` or `undefined`.
  // Note: derived classes *must* override this method.
  public abstract getCurrentPrice(): BN | null;

  // Gets the price (as a BN) for the time (+ ancillary data) specified. Similar to `getCurrentPrice()`, the price is
  // derived from the in-memory state of the price feed object, so this method is synchronous. This price should be
  // up-to-date as of the last time `update()` was called. If `update()` has never been called, this should throw. If
  // the time is before the pre-determined historical lookback window of this PriceFeed object, then this method should
  // throw. If the historical price could not be computed for any other reason, this method
  // should throw.
  // Note: derived classes *must* override this method.
  public abstract getHistoricalPrice(time: number, ancillaryData?: string, verbose?: boolean): Promise<BN | null>;

  // This returns the last time that the `update()` method was called. If it hasn't been called, this method should
  // return `null` or `undefined`.
  // Note: derived classes *must* override this method.
  public abstract getLastUpdateTime(): number | null;

  // This returns the precision that prices are returned in. It is called by the Medianizer price feed to enforce that all
  // of the pricefeeds are using the same precision.
  public abstract getPriceFeedDecimals(): number | null;

  // Returns the lookback window for a historical price query. Timestamps before (currentTime - lookback) will fail if passed into
  // `getHistoricalPrice`. This method can make clients more efficient by catching invalid historical timestamps early.
  public abstract getLookback(): number | null;
}
