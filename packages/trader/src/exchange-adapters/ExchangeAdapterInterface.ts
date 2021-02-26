class ExchangeAdapterInterface {
  // Take in a desired price and execute the trades required to move the market from the current price to desiredPrice.
  async tradeMarketToDesiredPrice(/* desiredPrice */) {
    this._abstractFunctionCalled();
  }

  // Returns the current spot price within the exchange.
  async getExchangeSpotPrice() {
    this._abstractFunctionCalled();
  }

  // Common function to throw an error if an interface method is called.
  _abstractFunctionCalled() {
    throw new Error("Abstract function called -- derived class should implement this function");
  }
}

module.exports = { ExchangeAdapterInterface };
