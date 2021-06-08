import * as uma from "@uma/sdk";
import assert from "assert";
import { Libs, CurrencySymbol } from "..";
import bluebird from "bluebird";
type Config = {
  currency?: CurrencySymbol;
  throttle?: number;
};
export default function (config: Config, libs: Libs) {
  const { currency = "usd", throttle = 100 } = config;
  const { coingecko, prices, collateralAddresses } = libs;
  assert(coingecko, "requires coingecko library");
  assert(prices[currency], `requires prices.${currency}`);

  // if we have a new emp address, this will create a new price table structure to store historical price data
  function getOrCreateHistoryTable(address: string) {
    if (prices[currency].history[address] == null) {
      prices[currency].history[address] = uma.tables.historicalPrices.SortedJsMap();
    }
    return prices[currency].history[address];
  }

  // utility to grab last price based on address
  function getLatestPrice(address: string) {
    return prices[currency].latest[address];
  }

  // pulls price from latest and stuffs it into historical table.
  async function updatePriceHistory(address: string) {
    const table = getOrCreateHistoryTable(address);
    const [timestamp, price] = getLatestPrice(address);
    // if this timestamp exists in the table, dont bother re-adding it
    assert(uma.utils.exists(price), "No latest price available for: " + address);
    assert(
      !(await table.hasByTimestamp(timestamp)),
      `Price already exists for address ${address} at timestamp: ${timestamp}`
    );
    return table.create({ timestamp, price });
  }

  async function updatePriceHistories(addresses: string[]) {
    return Promise.allSettled(addresses.map(updatePriceHistory));
  }

  async function updateLatestPrice(address: string) {
    const [timestamp, price] = await coingecko.getCurrentPriceByContract(address, currency);
    prices[currency].latest[address] = [timestamp, price.toString()];
  }

  async function updateLatestPrices(addresses: string[]) {
    // this is reproducing promise.allSettled api but in series with a throttle vs all parallel
    // coingecko might be sensitive to how fast we call for prices, so we throttle here in case.
    return bluebird.mapSeries(addresses, async (address) => {
      let result;
      try {
        result = {
          status: "fulfilled",
          value: await updateLatestPrice(address),
        };
      } catch (err) {
        result = {
          status: "rejected",
          reason: err,
        };
      }
      await new Promise((res) => setTimeout(res, throttle));
      return result;
    });
  }

  // Currently we just care about collateral prices
  async function update() {
    const addresses = Array.from(collateralAddresses.values());
    await updateLatestPrices(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error getting LatestPrice: " + result.reason.message);
      });
    });
    await updatePriceHistories(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating historical price: " + result.reason.message);
      });
    });
  }

  return {
    getOrCreateHistoryTable,
    getLatestPrice,
    updatePriceHistories,
    updatePriceHistory,
    updateLatestPrice,
    updateLatestPrices,
    update,
  };
}
