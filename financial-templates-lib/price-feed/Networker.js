const fetch = require("node-fetch");

// This class makes networking calls on behalf of the caller.
// Note: this is separated out to allow this functionality to be mocked out in tests so no real network calls have to
// be made.
class Networker {
  async getJson(url) {
    const response = await fetch(url);
    const json = await response.json();
    if (!json) {
      throw `Query [${url}] failed to get JSON`;
    }
    return json;
  }
}
