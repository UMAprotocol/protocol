// A mock of the Networker to allow the user to check the inputs and set the outputs of network requests.
class NetworkerMock {
  constructor() {
    // Value that will hold the most recent input to getJson.
    this.getJsonInputs = [];

    // Value that will be returned on the next call to getJson.
    // Users of this mock should set this value to force getJson to return the value.
    this.getJsonReturns = [];
  }

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
