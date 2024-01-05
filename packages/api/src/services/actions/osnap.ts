import assert from "assert";
import { Actions, Json, ActionCall } from "../../types";
import { MultiChainTenderly } from "../../libs/osnap";

type Config = {
  tenderlies: MultiChainTenderly;
};

export function Handlers(config: Config): Actions {
  const { tenderlies } = config;

  const actions: Actions = {
    async ping() {
      return "pong";
    },
    async chainsEnabled() {
      return tenderlies.chainsEnabled;
    },
    // TODO: fill out simulation fn
    // async simulate(){
    // }
  };

  // list all available actions
  const keys = Object.keys(actions);
  actions.actions = () => keys;

  return actions;
}
export default (config: Config): ActionCall => {
  const actions = Handlers(config);
  return async (action: string, ...args: Json[]): Promise<Json> => {
    assert(actions[action], `Invalid action: ${action}`);
    return actions[action](...args);
  };
};
