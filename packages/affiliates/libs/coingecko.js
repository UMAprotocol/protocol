const axios = require("axios");
const assert = require("assert");

module.exports = (host = "https://api.coingecko.com") => {
  async function call(url) {
    const result = await axios(url);
    return result.data;
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
