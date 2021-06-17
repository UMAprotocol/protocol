import assert from "assert";
import * as uma from "@uma/sdk";
import { Json, Actions, AppState, CurrencySymbol, PriceSample } from "..";
import Queries from "../libs/queries";
import { nowS } from "../libs/utils";

const { exists } = uma.utils;

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const queries = Queries(appState);
  const { registeredEmps, erc20s, collateralAddresses, syntheticAddresses, prices, stats } = appState;

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
    // get prices by token address
    latestPriceByTokenAddress: queries.latestPriceByTokenAddress,
    // get synthetic price in usd for an emp address
    async latestSyntheticPrice(empAddress: string, currency: CurrencySymbol = "usd") {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAnyEmp(empAddress);
      assert(exists(emp.tokenCurrency), "EMP does not have token currency address");
      return queries.latestPriceByTokenAddress(emp.tokenCurrency, currency);
    },
    // get collateral price in usd for an emp address
    async latestCollateralPrice(empAddress: string, currency: CurrencySymbol = "usd") {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAnyEmp(empAddress);
      assert(exists(emp.collateralCurrency), "EMP does not have collateral currency address");
      return queries.latestPriceByTokenAddress(emp.collateralCurrency, currency);
    },
    historicalPricesByTokenAddress: queries.historicalPricesByTokenAddress,
    sliceHistoricalPricesByTokenAddress: queries.sliceHistoricalPricesByTokenAddress,
    async historicalSynthPrices(empAddress: string, start = 0, end: number = Date.now()): Promise<PriceSample[]> {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAnyEmp(empAddress);
      assert(exists(emp.tokenCurrency), "EMP does not have token currency address");
      return queries.historicalPricesByTokenAddress(emp.tokenCurrency, start, end);
    },
    async sliceHistoricalSynthPrices(empAddress: string, start = 0, length = 1): Promise<PriceSample[]> {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAnyEmp(empAddress);
      assert(exists(emp.tokenCurrency), "EMP does not have token currency address");
      return queries.sliceHistoricalPricesByTokenAddress(emp.tokenCurrency, start, length);
    },
    async historicalCollateralPrices(empAddress: string, start = 0, end: number = Date.now()): Promise<PriceSample[]> {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAnyEmp(empAddress);
      assert(exists(emp.collateralCurrency), "EMP does not have token currency address");
      return queries.historicalPricesByTokenAddress(emp.collateralCurrency, start, end);
    },
    async sliceHistoricalCollateralPrices(empAddress: string, start = 0, length = 1): Promise<PriceSample[]> {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAnyEmp(empAddress);
      assert(exists(emp.collateralCurrency), "EMP does not have token currency address");
      return queries.sliceHistoricalPricesByTokenAddress(emp.collateralCurrency, start, length);
    },
    async getEmpStats(address: string, currency: CurrencySymbol = "usd") {
      assert(address, "requires address");
      assert(currency, "requires currency");
      assert(stats[currency], "No stats for currency: " + currency);
      return stats[currency].latest.get(address);
    },
    async listEmpStats(currency: CurrencySymbol = "usd") {
      assert(currency, "requires currency");
      assert(stats[currency], "No stats for currency: " + currency);
      return stats[currency].latest.values();
    },
    async tvl(addresses?: string[], currency: CurrencySymbol = "usd") {
      if (addresses == null || addresses.length == 0) return queries.totalTvl(currency);
      return queries.sumTvl(addresses, currency);
    },
    async getEmpStatsBetween(empAddress: string, start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") {
      assert(stats[currency], "Invalid currency type: " + currency);
      assert(stats[currency].history[empAddress], "Invalid emp address: " + empAddress);
      return stats[currency].history[empAddress].between(start, end);
    },
    async sliceHistoricalEmpStats(empAddress: string, start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(stats[currency], "Invalid currency type: " + currency);
      assert(stats[currency].history[empAddress], "Invalid emp address: " + empAddress);
      return stats[currency].history[empAddress].slice(start, length);
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
