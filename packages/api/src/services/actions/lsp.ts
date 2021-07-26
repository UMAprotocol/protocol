import assert from "assert";
import { Json, Actions, AppState } from "../..";
import Queries from "../../libs/queries";

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const queries = Queries(appState);
  const { registeredLsps, erc20s, collateralAddresses, longAddresses, shortAddresses } = appState;

  const actions: Actions = {
    listAddresses() {
      return Array.from(registeredLsps.values());
    },
    listActive: queries.listActiveLsps,
    listExpired: queries.listExpiredLsps,
    async getState(address: string) {
      assert(await registeredLsps.has(address), "Not a valid LSP address: " + address);
      const state = await queries.getAnyLsp(address);
      return queries.getFullLspState(state);
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
    async longAddresses() {
      return Array.from(longAddresses.values());
    },
    async shortAddresses() {
      return Array.from(shortAddresses.values());
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
