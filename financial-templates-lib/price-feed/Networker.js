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

  async getJson(url) {
    const response = await fetch(url);
    const json = await response.json();
    if (!json) {
      this.logger.error({
        at: "Networker",
        message: "Failed to get json response🚨",
        url: url,
        error: new Error(response)
      });
    }
    return json;
  }
}

module.exports = {
  Networker
};
