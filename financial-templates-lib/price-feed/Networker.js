const fetch = require("node-fetch");

// This class makes networking calls on behalf of the caller.
// Note: this is separated out to allow this functionality to be mocked out in tests so no real network calls have to
// be made.
class Networker {
  constructor(logger) {
    this.logger = logger;
  }

  async getJson(url) {
    const response = await fetch(url);
    const json = await response.json();
    if (!json) {
      this.logger.error({
        at: "Networker",
        message: "Failed to get json response",
        url: url
      });
    }
    return json;
  }
}

module.exports = {
  Networker
};
