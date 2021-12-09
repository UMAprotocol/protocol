import axios from "axios";
import get from "lodash/get";

type GasPrice = {
  safeLow: number;
  standard: number;
  fast: number;
  fastest: number;
  currentBaseFee: number;
  recommendedBaseFee: number;
};

export class Etherchain {
  constructor(private url = "https://www.etherchain.org/api") {}

  public async getGasPrice(): Promise<GasPrice> {
    try {
      const endpoint = this.url + "/gasPriceOracle";
      const result = await axios.get(endpoint);
      return result.data;
    } catch (err) {
      const msg = get(err, "response.data.error", get(err, "response.statusText", "Unknown Coingecko Error"));
      throw new Error(msg);
    }
  }
}
