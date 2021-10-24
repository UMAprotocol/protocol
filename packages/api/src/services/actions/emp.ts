import assert from "assert";
import * as uma from "@uma/sdk";
import { Json, Actions, AppState, CurrencySymbol, PriceSample } from "../../types";
import * as Queries from "../../libs/queries";
import { nowS } from "../../libs/utils";
import lodash from "lodash";

const { exists } = uma.utils;

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const queries = Queries.Emp(appState);
  const {
    registeredEmps,
    erc20s,
    collateralAddresses,
    syntheticAddresses,
    prices,
    stats,
    synthPrices,
    marketPrices,
  } = appState;

  const actions: Actions = {
    echo(...args: Json[]) {
      return args;
    },
    listEmpAddresses() {
      return registeredEmps.keys();
    },
    lastBlock() {
      return appState.appStats.getLastBlockUpdate();
    },
    hasAddress: queries.hasAddress,
    // deprecated
    listActiveEmps: queries.listActive,
    // deprecated
    listExpiredEmps: queries.listExpired,
    listActive: queries.listActive,
    listExpired: queries.listExpired,
    // deprecated
    async getEmpState(address: string) {
      assert(await registeredEmps.has(address), "Not a valid emp address: " + address);
      const state = await queries.getAny(address);
      return queries.getFullState(state);
    },
    async getState(address: string) {
      assert(await registeredEmps.has(address), "Not a valid emp address: " + address);
      const state = await queries.getAny(address);
      return queries.getFullState(state);
    },
    async getErc20Info(address: string) {
      return erc20s.get(address);
    },
    async allErc20Info() {
      return erc20s.values();
    },
    async collateralAddresses() {
      return await collateralAddresses.keys();
    },
    async syntheticAddresses() {
      return await syntheticAddresses.keys();
    },
    async allLatestPrices(currency: CurrencySymbol = "usd") {
      assert(exists(prices[currency]), "invalid currency type: " + currency);
      const priceSamples = await prices[currency].latest.values();
      return priceSamples.reduce(
        (acc, { price, timestamp, address }) => ({ ...acc, [address]: [price, timestamp] }),
        {}
      );
    },
    async allIdentifierPrices() {
      const synthPriceValues = await synthPrices.latest.values();
      return synthPriceValues.reduce(
        (acc, { address, timestamp, price }) => ({ ...acc, [address]: [timestamp, price] }),
        {}
      );
    },
    async allLatestMarketPrices() {
      const marketPricesValues = await marketPrices.usdc.latest.values();
      return marketPricesValues.reduce(
        (acc, { address, timestamp, price }) => ({ ...acc, [address]: [timestamp, price] }),
        {}
      );
    },
    // get prices by token address
    latestPriceByTokenAddress: queries.latestPriceByTokenAddress,
    // get synthetic price in usd for an emp address
    async latestSyntheticPrice(empAddress: string, currency: CurrencySymbol = "usd") {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAny(empAddress);
      assert(exists(emp.tokenCurrency), "EMP does not have token currency address");
      return queries.latestPriceByTokenAddress(emp.tokenCurrency, currency);
    },
    // get collateral price in usd for an emp address
    async latestCollateralPrice(empAddress: string, currency: CurrencySymbol = "usd") {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAny(empAddress);
      assert(exists(emp.collateralCurrency), "EMP does not have collateral currency address");
      return queries.latestPriceByTokenAddress(emp.collateralCurrency, currency);
    },
    historicalPricesByTokenAddress: queries.historicalPricesByTokenAddress,
    sliceHistoricalPricesByTokenAddress: queries.sliceHistoricalPricesByTokenAddress,
    async historicalSynthPrices(empAddress: string, start = 0, end: number = Date.now()): Promise<PriceSample[]> {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAny(empAddress);
      assert(exists(emp.tokenCurrency), "EMP does not have token currency address");
      return queries.historicalPricesByTokenAddress(emp.tokenCurrency, start, end);
    },
    async historicalCollateralPrices(empAddress: string, start = 0, end: number = Date.now()): Promise<PriceSample[]> {
      assert(empAddress, "requires an empAddress");
      const emp = await queries.getAny(empAddress);
      assert(exists(emp.collateralCurrency), "EMP does not have token currency address");
      return queries.historicalPricesByTokenAddress(emp.collateralCurrency, start, end);
    },
    async sliceHistoricalSynthPrices(empAddress: string, start = 0, length = 1): Promise<PriceSample[]> {
      assert(empAddress, "requires an empAddress");
      assert(length < 1000, "length must be less than 1000 samples");
      const emp = await queries.getAny(empAddress);
      assert(exists(emp.tokenCurrency), "EMP does not have token currency address");
      return queries.sliceHistoricalPricesByTokenAddress(emp.tokenCurrency, start, length);
    },
    async sliceHistoricalCollateralPrices(empAddress: string, start = 0, length = 1): Promise<PriceSample[]> {
      assert(empAddress, "requires an empAddress");
      assert(length < 1000, "length must be less than 1000 samples");
      const emp = await queries.getAny(empAddress);
      assert(exists(emp.collateralCurrency), "EMP does not have token currency address");
      return queries.sliceHistoricalPricesByTokenAddress(emp.collateralCurrency, start, length);
    },
    async tvl(addresses: string[] = [], currency: CurrencySymbol = "usd") {
      if (addresses == null || addresses.length == 0) return queries.getTotalTvl(currency);
      addresses = addresses ? lodash.castArray(addresses) : [];
      return queries.sumTvl(addresses, currency);
    },
    async tvm(addresses: string[] = [], currency: CurrencySymbol = "usd") {
      if (addresses == null || addresses.length == 0) return queries.totalTvm(currency);
      addresses = addresses ? lodash.castArray(addresses) : [];
      return queries.sumTvm(addresses, currency);
    },
    async tvlHistoryBetween(empAddress: string, start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") {
      assert(stats.emp[currency], "Invalid currency type: " + currency);
      return stats.emp[currency].history.tvl.betweenByAddress(empAddress, start, end);
    },
    async tvmHistoryBetween(empAddress: string, start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") {
      assert(stats.emp[currency], "Invalid currency type: " + currency);
      return stats.emp[currency].history.tvm.betweenByAddress(empAddress, start, end);
    },
    async globalTvlHistoryBetween(start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") {
      assert(stats.emp[currency], "Invalid currency type: " + currency);
      return stats.emp[currency].history.tvl.betweenByGlobal(start, end);
    },
    async tvlHistorySlice(empAddress: string, start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(stats.emp[currency], "Invalid currency type: " + currency);
      return stats.emp[currency].history.tvl.sliceByAddress(empAddress, start, length);
    },
    async globalTvlSlice(start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(stats.emp[currency], "Invalid currency type: " + currency);
      return stats.emp[currency].history.tvl.sliceByGlobal(start, length);
    },
    async tvmHistorySlice(empAddress: string, start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(stats.emp[currency], "Invalid currency type: " + currency);
      assert(length < 1000, "length must be less than 1000 samples");
      return stats.emp[currency].history.tvm.sliceByAddress(empAddress, start, length);
    },
    async listTvls(currency: CurrencySymbol = "usd") {
      return appState.stats.emp[currency].latest.tvl.values();
    },
    async listTvms(currency: CurrencySymbol = "usd") {
      return appState.stats.emp[currency].latest.tvm.values();
    },
    async historicalMarketPricesBetween(tokenAddress: string, start = 0, end: number = nowS()) {
      assert(tokenAddress, "requires token address");
      return marketPrices.usdc.history.betweenByAddress(tokenAddress, start, end);
    },
    async sliceHistoricalMarketPrices(tokenAddress: string, start = 0, length = 1) {
      assert(tokenAddress, "requires token address");
      assert(length < 1000, "length must be less than 1000 samples");
      return marketPrices.usdc.history.sliceByAddress(tokenAddress, start, length);
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
