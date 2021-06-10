import assert from "assert";
import * as uma from "@uma/sdk";
import { Json, Actions, Libs, CurrencySymbol, PriceSample } from "..";
import Queries from "../libs/queries";

const { exists } = uma.utils;

export function Handlers(config: Json, libs: Libs): Actions {
  const queries = Queries(libs);

  const actions: Actions = {
    echo(...args: Json[]) {
      return args;
    },
    listEmpAddresses() {
      return Array.from(libs.registeredEmps.values());
    },
    lastBlock() {
      return libs.lastBlock;
    },
    listActiveEmps: queries.listActiveEmps,
    listExpiredEmps: queries.listExpiredEmps,
    async getEmpState(address: string) {
      assert(await libs.registeredEmps.has(address), "Not a valid emp address: " + address);
      const state = await queries.getAnyEmp(address);
      return queries.getFullEmpState(state);
    },
    async getErc20Info(address: string) {
      return libs.erc20s.get(address);
    },
    async allErc20Info() {
      return libs.erc20s.values();
    },
    async collateralAddresses() {
      return Array.from(libs.collateralAddresses.values());
    },
    async syntheticAddresses() {
      return Array.from(libs.syntheticAddresses.values());
    },
    async allLatestPrices(currency: CurrencySymbol = "usd") {
      assert(exists(libs.prices[currency]), "invalid currency type: " + currency);
      return libs.prices[currency].latest;
    },
    async latestPriceByAddress(address: string, currency: CurrencySymbol = "usd") {
      assert(address, "requires an erc20 token address");
      assert(exists(libs.prices[currency]), "invalid currency type: " + currency);
      const priceSample = libs.prices[currency].latest[address];
      assert(exists(priceSample), "No price for address: " + address);
      return priceSample;
    },
    async historicalPricesByAddress(
      address: string,
      start = 0,
      end: number = Date.now(),
      currency: "usd" = "usd"
    ): Promise<PriceSample[]> {
      assert(start >= 0, "requires a start value >= 0");
      assert(exists(libs.prices[currency]), "invalid currency type: " + currency);
      assert(exists(libs.prices[currency].history[address]), "no prices for address" + address);
      const prices = await libs.prices[currency].history[address].betweenByTimestamp(start, end);
      // convert this to tuple to save bytes.
      return prices.map(({ price, timestamp }) => [timestamp, price]);
    },
    async sliceHistoricalPricesByAddress(
      address: string,
      start = 0,
      length = 1,
      currency: "usd" = "usd"
    ): Promise<PriceSample[]> {
      assert(start >= 0, "requires a start value >= 0");
      assert(exists(libs.prices[currency]), "invalid currency type: " + currency);
      assert(exists(libs.prices[currency].history[address]), "no prices for address" + address);
      const prices = await libs.prices[currency].history[address].sliceByTimestamp(start, length);
      // convert this to tuple to save bytes.
      return prices.map(({ price, timestamp }) => [timestamp, price]);
    },
  };

  // list all available actions
  const keys = Object.keys(actions);
  actions.actions = () => keys;

  return actions;
}
export default (config: Json, libs: Libs) => {
  const actions = Handlers(config, libs);
  return async (action: string, ...args: Json[]) => {
    assert(actions[action], `Invalid action: ${action}`);
    return actions[action](...args);
  };
};
