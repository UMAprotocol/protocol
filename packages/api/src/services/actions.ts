import assert from "assert";
import * as uma from "@uma/sdk";
import { Json, Actions, AppState, CurrencySymbol, PriceSample } from "..";
import Queries from "../libs/queries";

const { exists } = uma.utils;

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const queries = Queries(appState);
  const { registeredEmps, erc20s, collateralAddresses, syntheticAddresses, prices } = appState;

  const actions: Actions = {
    echo(...args: Json[]) {
      return args;
    },
    listEmpAddresses() {
      return Array.from(registeredEmps.values());
    },
    lastBlock() {
      return appState.lastBlock;
    },
    listActiveEmps: queries.listActiveEmps,
    listExpiredEmps: queries.listExpiredEmps,
    async getEmpState(address: string) {
      assert(await registeredEmps.has(address), "Not a valid emp address: " + address);
      const state = await queries.getAnyEmp(address);
      return queries.getFullEmpState(state);
    },
    async getErc20Info(address: string) {
      return erc20s.get(address);
    },
    async allErc20Info() {
      return erc20s.values();
    },
    async collateralAddresses() {
      return Array.from(collateralAddresses.values());
    },
    async syntheticAddresses() {
      return Array.from(syntheticAddresses.values());
    },
    async allLatestPrices(currency: CurrencySymbol = "usd") {
      assert(exists(prices[currency]), "invalid currency type: " + currency);
      return prices[currency].latest;
    },
    async latestPriceByAddress(address: string, currency: CurrencySymbol = "usd") {
      assert(address, "requires an erc20 token address");
      assert(exists(prices[currency]), "invalid currency type: " + currency);
      const priceSample = prices[currency].latest[address];
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
      assert(exists(prices[currency]), "invalid currency type: " + currency);
      assert(exists(prices[currency].history[address]), "no prices for address" + address);
      const results = await prices[currency].history[address].betweenByTimestamp(start, end);
      // convert this to tuple to save bytes.
      return results.map(({ price, timestamp }) => [timestamp, price]);
    },
    async sliceHistoricalPricesByAddress(
      address: string,
      start = 0,
      length = 1,
      currency: "usd" = "usd"
    ): Promise<PriceSample[]> {
      assert(start >= 0, "requires a start value >= 0");
      assert(exists(prices[currency]), "invalid currency type: " + currency);
      assert(exists(prices[currency].history[address]), "no prices for address" + address);
      const results = await prices[currency].history[address].sliceByTimestamp(start, length);
      // convert this to tuple to save bytes.
      return results.map(({ price, timestamp }) => [timestamp, price]);
    },
  };

  // list all available actions
  const keys = Object.keys(actions);
  actions.actions = () => keys;

  return actions;
}
export default (config: Config, appState: AppState) => {
  const actions = Handlers(config, appState);
  return async (action: string, ...args: Json[]) => {
    assert(actions[action], `Invalid action: ${action}`);
    return actions[action](...args);
  };
};
