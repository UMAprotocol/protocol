import assert from "assert";
import { Json, Actions, AppState, AllContractStates } from "../../types";
import bluebird from "bluebird";
import { Handlers as EmpActions } from "./emp";
import { Handlers as LspActions } from "./lsp";

// actions use all the app state
type Dependencies = AppState;
type Config = undefined;

export function Handlers(config: Config, appState: Dependencies): Actions {
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
