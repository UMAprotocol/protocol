import assert from "assert";
import { Json, Actions, AppState, CurrencySymbol } from "../../types";
import lodash from "lodash";
import * as Queries from "../../libs/queries";
import { nowS } from "../../libs/utils";

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const queries = Queries.Lsp(appState);
  const { registeredLsps, erc20s, collateralAddresses, longAddresses, shortAddresses, stats } = appState;

  const actions: Actions = {
    async listAddresses() {
      return await registeredLsps.keys();
    },
    hasAddress: queries.hasAddress,
    listActive: queries.listActive,
    listExpired: queries.listExpired,
    async getState(address: string) {
      assert(await registeredLsps.has(address), "Not a valid LSP address: " + address);
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
    async longAddresses() {
      return await longAddresses.keys();
    },
    async shortAddresses() {
      return await shortAddresses.keys();
    },
    async listTvls(currency: CurrencySymbol = "usd") {
      return appState.stats.lsp[currency].latest.tvl.values();
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
    async tvlHistoryBetween(
      contractAddress: string,
      start = 0,
      end: number = nowS(),
      currency: CurrencySymbol = "usd"
    ) {
      assert(stats.lsp[currency], "Invalid currency type: " + currency);
      return stats.lsp[currency].history.tvl.betweenByAddress(contractAddress, start, end);
    },
    // this is not supported
    async tvmHistoryBetween() {
      throw new Error("LSP does not support TVM History");
    },
    // this is not supported
    async tvmHistorySlice() {
      throw new Error("LSP does not support TVM History");
    },
    async tvlHistorySlice(contractAddress: string, start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(stats.lsp[currency], "Invalid currency type: " + currency);
      return stats.lsp[currency].history.tvl.sliceByAddress(contractAddress, start, length);
    },
    async totalTvlHistoryBetween(start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") {
      assert(stats.lsp[currency], "Invalid currency type: " + currency);
      return stats.lsp[currency].history.tvl.betweenByGlobal(start, end);
    },
    async totalTvlSlice(start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(stats.lsp[currency], "Invalid currency type: " + currency);
      return stats.lsp[currency].history.tvl.sliceByGlobal(start, length);
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
