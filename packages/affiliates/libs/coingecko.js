const axios = require("axios");
const assert = require("assert");

module.exports = (host = "https://api.coingecko.com") => {
  async function call(url) {
    const result = await axios(url);
    return result.data;
  }

  // Fetch historic prices for a `contract` denominated in `currency` between timestamp `from` and `to`. Note timestamps
  // are assumed to be js timestamps and are converted to unixtimestamps by dividing by 1000.
  async function getHistoricContractPrices(contract, currency, from, to) {
    assert(contract, "requires contract address");
    assert(currency, "requires currency symbol");
    assert(from, "requires from timestamp");
    assert(to, "requires to timestamp");
    from = from / 1000;
    to = to / 1000;
    const result = await call(
      `${host}/api/v3/coins/ethereum/contract/${contract.toLowerCase()}/market_chart/range/?vs_currency=${currency}&from=${from}&to=${to}`
    );
    if (result.prices) return result.prices;
    else throw new Error("Something went wrong fetching coingecko prices!");
  }

  return {
    call,
    getHistoricContractPrices
  };
};
