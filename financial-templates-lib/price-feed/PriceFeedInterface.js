// Price feed interface -- all price feed implementations should override all functions (except for _abstractFunctionCalled).
class PriceFeedInterface {
  // Updates the internal state of the price feed. Should pull in any async data so the get*Price methods can be called.
  // Note: derived classes *must* override this method.
  async update() {
    this._abstractFunctionCalled();
  }

  // Gets the current price (as a BN) for this feed synchronously from the in-memory state of this price feed object.
  // This price should be up-to-date as of the last time `update()` was called. If `update()` has never been called,
  // this should return `null` or `undefined`. If no price could be retrieved, it should return `null` or `undefined`.
  // Note: derived classes *must* override this method.
  getCurrentPrice() {
    this._abstractFunctionCalled();
  }

  // Gets the price (as a BN) for the time specified. Similar to `getCurrentPrice()`, the price is derived from the
  // in-memory state of the price feed object, so this method is syncrhonous. This price should be up-to-date as of the
  // last time `update()` was called. If `update()` has never been called, this should return `null` or `undefined. If
  // the time is before the pre-determined historical lookback window of this PriceFeed object, then this method should
  // return `null` or `undefined`. If the historical price could not be computed for any other reason, this method
  // should return `null` or `undefined`.
  // Note: derived classes *must* override this method.
  getHistoricalPrice(time) {
    this._abstractFunctionCalled();
  }

  // This returns the last time that the `update()` method was called. If it hasn't been called, this method should
  // return `null` or `undefined`.
  // Note: derived classes *must* override this method.
  getLastUpdateTime() {
    this._abstractFunctionCalled();
  }

  // Common function to throw an error if an interface method is called.
  _abstractFunctionCalled() {
    throw new Error("Abstract function called -- derived class should implement this function");
  }
}

module.exports = {
  PriceFeedInterface
};
