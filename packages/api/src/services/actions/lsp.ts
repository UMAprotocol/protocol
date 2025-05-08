import assert from "assert";
import { Json, Actions, AppState } from "../../types";
import * as Queries from "../../libs/queries";

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
  const queries = Queries.Lsp(appState);
  const { registeredLsps, erc20s, collateralAddresses, longAddresses, shortAddresses } = appState;

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
