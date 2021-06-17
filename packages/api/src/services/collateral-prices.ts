import * as uma from "@uma/sdk";
import assert from "assert";
import { AppState, CurrencySymbol } from "..";
type Config = {
  currency?: CurrencySymbol;
};
type Dependencies = Pick<AppState, "coingecko" | "prices" | "collateralAddresses">;

export default function (config: Config, appState: Dependencies) {
  const { currency = "usd" } = config;
  const { coingecko, prices, collateralAddresses } = appState;
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
    const result = prices[currency].latest[address];
    assert(uma.utils.exists(result), "no latest price found for: " + address);
    return result;
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

  // does not do any queries, just a helper to mutate the latest price table
  function updateLatestPrice(params: { address: string; price: number; timestamp: number }) {
    const { address, timestamp, price } = params;
    prices[currency].latest[address] = [timestamp, price.toString()];
    return params;
  }

  async function updateLatestPrices(addresses: string[]) {
    const prices = await coingecko.getContractPrices(addresses, currency);
    return prices.map(updateLatestPrice);
  }

  // Currently we just care about collateral prices
  async function update() {
    const addresses = Array.from(collateralAddresses.values());
    await updateLatestPrices(addresses).catch((err) => {
      console.error("Error getting LatestPrice: " + err.message);
    });
    await updatePriceHistories(addresses).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error updating historical price: " + result.reason.message);
      });
    });
  }

  return {
    update,
    // internal functions meant to support updating
    utils: {
      getOrCreateHistoryTable,
      getLatestPrice,
      updatePriceHistories,
      updatePriceHistory,
      updateLatestPrice,
      updateLatestPrices,
    },
  };
}
