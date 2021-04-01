// This class makes networking calls on behalf of the caller. Note: this is separated out to allow this functionality
// to be mocked out in tests so no real network calls have to be made.

const fetch = require("node-fetch");

class Networker {
  /**
   * @notice Constructs new Networker.
   * @param {Object} logger Winston module used to send logs.
   */
  constructor(logger) {
    this.logger = logger;
  }

  async getJson(url, options) {
    const response = await fetch(url, options);
    const json = await response.json();
    if (!json) {
      // Throw if no error. Will result in a retry upstream.
      throw new Error(`Networker failed to get json response. Response: ${response}`);
    }
    return json;
  }
}

module.exports = {
  Networker
};
