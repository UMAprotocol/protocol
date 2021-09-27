import * as uma from "@uma/sdk";
import bluebird from "bluebird";
import assert from "assert";
import { AppState, CurrencySymbol, BaseConfig } from "..";
interface Config extends BaseConfig {
  currency?: CurrencySymbol;
}
import { parseUnits, msToS } from "../libs/utils";

type Dependencies = Pick<AppState, "coingecko" | "prices" | "collateralAddresses">;

export default function (config: Config, appState: Dependencies) {
  const { currency = "usd" } = config;
  const { coingecko, prices, collateralAddresses } = appState;
  assert(coingecko, "requires coingecko library");
  assert(prices[currency], `requires prices.${currency}`);

  // if we have a new emp address, this will create a new price table structure to store historical price data
  function getOrCreateHistoryTable(address: string) {
    if (prices[currency].history[address] == null) {
      prices[currency].history[address] = uma.tables.historicalPrices.Table();
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
    // we need to store prices in wei, so use parse units on this price
    prices[currency].latest[address] = [timestamp, parseUnits(price.toString()).toString()];
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

  async function backfillHistory(tokenAddress: string, startMs: number, endMs: number = Date.now()) {
    const table = getOrCreateHistoryTable(tokenAddress);
    const priceHistory = await coingecko.getHistoricContractPrices(tokenAddress, startMs, endMs, currency);
    await bluebird.map(priceHistory, async ([timestamp, price]: [number, string]) => {
      if (await table.hasByTimestamp(timestamp)) return;
      // timestamp is returned as ms, even though other calls return in S, we must convert
      // price returned in decimals, we want in in wei internally
      return table.create({ timestamp: msToS(timestamp), price: parseUnits(price.toString()).toString() });
    });
    return priceHistory;
  }

  async function backfillHistories(tokenAddresses: string[], startMs: number, endMs: number = Date.now()) {
    return bluebird.map(tokenAddresses, async (address) => {
      try {
        return {
          status: "fullfilled",
          value: await backfillHistory(address, startMs, endMs),
        };
      } catch (err) {
        return {
          status: "rejected",
          reason: err,
        };
      }
    });
  }

  async function backfill(startMs: number) {
    const addresses = Array.from(collateralAddresses.values());
    await backfillHistories(addresses, startMs).then((results) => {
      results.forEach((result) => {
        if (result.status === "rejected") console.error("Error backfilling prices: " + result.reason.message);
      });
    });
  }

  return {
    update,
    backfill,
    // internal functions meant to support updating
    utils: {
      getOrCreateHistoryTable,
      getLatestPrice,
      updatePriceHistories,
      updatePriceHistory,
      updateLatestPrice,
      updateLatestPrices,
      backfillHistory,
      backfillHistories,
    },
  };
}
