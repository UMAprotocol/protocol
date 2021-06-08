import assert from "assert";
import { Libs } from "..";
import bluebird from "bluebird";
type Config = {
  currency?: "usd";
  throttle?: number;
};
export default function (config: Config, libs: Libs) {
  const { currency = "usd", throttle = 100 } = config;
  const { coingecko, prices, collateralAddresses } = libs;
  assert(coingecko, "requires coingecko library");
  assert(prices[currency], `requires prices.${currency}`);

  async function updatePrice(address: string) {
    const [timestamp, price] = await coingecko.getCurrentPriceByContract(address, currency);
    prices[currency].latest[address] = [timestamp, price.toString()];
  }

  async function updatePrices(addresses: string[]) {
    await bluebird.mapSeries(addresses, async (address) => {
      await updatePrice(address);
      await new Promise((res) => setTimeout(res, throttle));
    });
  }

  // currenly we just care about collateral prices
  async function update() {
    await updatePrices(Array.from(collateralAddresses.values()));
  }

  return {
    updatePrice,
    updatePrices,
    update,
  };
}
