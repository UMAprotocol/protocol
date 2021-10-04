import assert from "assert";
import { Json, Actions, AppState, CurrencySymbol, AllContractStates } from "../../types";
import bluebird from "bluebird";
import { BigNumber } from "ethers";
import { nowS } from "../../libs/utils";
import { Handlers as EmpActions } from "./emp";
import { Handlers as LspActions } from "./lsp";

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const { stats } = appState;
  const contractActions = [EmpActions(config, appState), LspActions(config, appState)];

  const actions: Actions = {
    echo(...args: Json[]) {
      return args;
    },
    async listActive() {
      return bluebird.reduce(
        contractActions,
        async (result: AllContractStates[], actions) => {
          return result.concat((await actions.listActive()) as AllContractStates[]);
        },
        []
      );
    },
    async listExpired() {
      return bluebird.reduce(
        contractActions,
        async (result: AllContractStates[], actions) => {
          return result.concat((await actions.listExpired()) as AllContractStates[]);
        },
        []
      );
    },
    // return the first address found
    async getState(address: string) {
      assert(address, "requires a contract address");
      for (const action of contractActions) {
        if (await action.hasAddress(address)) {
          return action.getState(address);
        }
      }
      throw new Error("Unable to find contract address " + address);
    },
    async globalTvl(currency: CurrencySymbol = "usd") {
      const sum = await bluebird.reduce(
        contractActions,
        async (sum, actions) => {
          return sum.add(((await actions.tvl(undefined, currency)) as string) || "0");
        },
        BigNumber.from("0")
      );
      return sum.toString();
    },
    async tvl(address: string, currency: CurrencySymbol = "usd") {
      assert(address, "requires a contract address");
      for (const action of contractActions) {
        if (await action.hasAddress(address)) {
          return action.tvl([address], currency);
        }
      }
      throw new Error("Unable to find TVL for address " + address);
    },
    async globalTvm(currency: CurrencySymbol = "usd") {
      const sum = await bluebird.reduce(
        contractActions,
        async (sum, actions) => {
          return sum.add(((await actions.tvm(undefined, currency)) as string) || "0");
        },
        BigNumber.from("0")
      );
      return sum.toString();
    },
    async globalTvlHistoryBetween(start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") {
      assert(stats.global[currency], "Invalid currency type: " + currency);
      return stats.global[currency].history.tvl.betweenByGlobal(start, end);
    },
    async tvlHistoryBetween(address: string, start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") {
      assert(address, "requires contract address");
      // otherwise look up tvl for contract
      for (const action of contractActions) {
        if (await action.hasAddress(address)) {
          return await action.tvlHistoryBetween(address, start, end, currency);
        }
      }
      throw new Error("Unable to find TVL History between for address " + address);
    },
    async globalTvlHistorySlice(start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(stats.global[currency], "Invalid currency type: " + currency);
      return stats.global[currency].history.tvl.sliceByGlobal(start, length);
    },
    async tvlHistorySlice(address: string, start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(address, "requires contract address");
      for (const action of contractActions) {
        if (await action.hasAddress(address)) {
          return action.tvlHistorySlice(address, start, length, currency);
        }
      }
      throw new Error("Unable to find TVL History slice for address " + address);
    },
    async tvm(address: string, currency: CurrencySymbol = "usd") {
      assert(address, "requires contract address");
      for (const action of contractActions) {
        if (await action.hasAddress(address)) {
          return await action.tvm([address], currency);
        }
      }
      throw new Error("Unable to find TVM for address " + address);
    },
    async tvmHistoryBetween(address: string, start = 0, end: number = nowS(), currency: CurrencySymbol = "usd") {
      assert(address, "requires contract address");
      for (const action of contractActions) {
        if (await action.hasAddress(address)) {
          return await action.tvmHistoryBetween(address, start, end, currency);
        }
      }
      throw new Error("Unable to find TVM History between for address " + address);
    },
    async tvmHistorySlice(address: string, start = 0, length = 1, currency: CurrencySymbol = "usd") {
      assert(address, "requires contract address");
      for (const action of contractActions) {
        if (await action.hasAddress(address)) {
          return await action.tvmHistorySlice(address, start, length, currency);
        }
      }
      throw new Error("Unable to find TVM History slice for address " + address);
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
