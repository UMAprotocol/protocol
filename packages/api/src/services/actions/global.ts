import assert from "assert";
import { Json, Actions, AppState, CurrencySymbol, AllContractStates } from "../..";
import * as Queries from "../../libs/queries";
import bluebird from "bluebird";
import { BigNumber } from "ethers";
import { nowS } from "../../libs/utils";

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const { stats } = appState;
  const queries = [Queries.Emp(appState), Queries.Lsp(appState)];

  const actions: Actions = {
    echo(...args: Json[]) {
      return args;
    },
    async listActive() {
      return bluebird.reduce(
        queries,
        async (result: AllContractStates[], query) => {
          return result.concat(await query.listActive());
        },
        []
      );
    },
    async listExpired() {
      return bluebird.reduce(
        queries,
        async (result: AllContractStates[], query) => {
          return result.concat(await query.listExpired());
        },
        []
      );
    },
    // return the first address found
    async getState(address: string) {
      assert(address, "requires a contract address");
      for (const query of queries) {
        try {
          const state = await query.getAny(address);
          return query.getFullState(state);
        } catch (err) {
          // do nothing
        }
      }
      throw new Error("Unable to find contract address " + address);
    },
    async tvl(currency: CurrencySymbol = "usd") {
      const sum = await bluebird.reduce(
        queries,
        async (sum, queries) => {
          return sum.add((await queries.getTotalTvl(currency)) || "0");
        },
        BigNumber.from("0")
      );
      return sum.toString();
    },
    async tvlHistoryBetween(start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") {
      assert(stats.global[currency], "Invalid currency type: " + currency);
      return stats.global[currency].history.tvl.betweenByGlobal(start, end);
    },
    async tvlHistorySlice(start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(stats.global[currency], "Invalid currency type: " + currency);
      return stats.global[currency].history.tvl.sliceByGlobal(start, length);
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
