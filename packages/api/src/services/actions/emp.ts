import assert from "assert";
import { Json, Actions, AppState } from "../../types";
import * as Queries from "../../libs/queries";

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const queries = Queries.Emp(appState);
  const { registeredEmps, erc20s, collateralAddresses, syntheticAddresses } = appState;

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
