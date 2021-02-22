class ExchangeAdapterInterface {
  constructor() {}
  async tradeMarketToDesiredPrice(/* desiredPrice */) {
    this._abstractFunctionCalled();
  }

  // Common function to throw an error if an interface method is called.
  _abstractFunctionCalled() {
    throw new Error("Abstract function called -- derived class should implement this function");
  }
}

module.exports = { ExchangeAdapterInterface };
