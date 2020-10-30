const axios = require("axios");
const assert = require("assert");
const { get } = require("lodash");

module.exports = (host = "https://api.coingecko.com") => {
  async function call(url) {
    try {
      const result = await axios(url);
      return result.data;
    } catch (err) {
      const msg = get(err, "response.data.error", "Coingecko error");
      throw new Error(msg);
    }
  }

  function chart(contract, currency, days) {
    assert(contract, "requires contract adddres");
    assert(currency, "requires currency symbol");
    assert(days, "requires days of history");
    return call(
      `${host}/api/v3/coins/ethereum/contract/${contract.toLowerCase()}/market_chart/?vs_currency=${currency}&days=${days}`
    );
  }

  return {
    call,
    chart
  };
};
