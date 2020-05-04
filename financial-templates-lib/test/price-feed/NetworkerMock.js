// An implementation of PriceFeedInterface that uses a Uniswap v2 TWAP as the price feed source.
class NetworkerMock {
  // Value that will hold the most recent input to getJson.
  getJsonInputs = [];

  // Value that will be returned on the next call to getJson.
  // Users of this mock should set this value to force getJson to return the value.
  getJsonReturns = [];

  // Mocked getJson function.
  async getJson(url) {
    // Note: shift and unshift add and remove from the front of the array, so the elements are ordered such that the
    // first elements in the arrays are the first in/out.
    this.getJsonInputs.unshift(url);
    return this.getJsonReturns.shift();
  }
}

module.exports = {
  NetworkerMock
};
