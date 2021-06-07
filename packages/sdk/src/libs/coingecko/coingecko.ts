import axios from "axios";
import assert from "assert";
import { get } from "lodash";

class Coingecko {
  private host: string;
  constructor(host = "https://api.coingecko.com") {
    this.host = host;
  }
  // Fetch historic prices for a `contract` denominated in `currency` between timestamp `from` and `to`. Note timestamps
  // are assumed to be js timestamps and are converted to unixtimestamps by dividing by 1000.
  async getHistoricContractPrices(contract: string, from: number, to: number, currency = "usd") {
    assert(contract, "requires contract address");
    assert(currency, "requires currency symbol");
    assert(from, "requires from timestamp");
    assert(to, "requires to timestamp");
    from = from / 1000;
    to = to / 1000;
    const { host } = this;
    const result = await Coingecko.call(
      `${host}/api/v3/coins/ethereum/contract/${contract.toLowerCase()}/market_chart/range/?vs_currency=${currency}&from=${from}&to=${to}`
    );
    if (result.prices) return result.prices;
    else throw new Error("Something went wrong fetching coingecko prices!");
  }
  async getContractDetails(contract_address: string, id = "ethereum") {
    const { host } = this;
    return Coingecko.call(`${host}/api/v3/coins/${id}/contract/${contract_address.toLowerCase()}`);
  }
  async getCurrentPriceByContract(contract_address: string, currency = "usd") {
    const result = await this.getContractDetails(contract_address);
    const price = get(result, ["market_data", "current_price", currency], null);
    assert(price !== null, "No current price available for: " + contract_address);
    const timestamp = new Date(result.last_updated).valueOf();
    return [timestamp, price];
  }
  static async call(url: string) {
    try {
      const result = await axios(url);
      return result.data;
    } catch (err) {
      const msg = get(err, "response.data.error", "Coingecko error");
      throw new Error(msg);
    }
  }
}
export default Coingecko;
