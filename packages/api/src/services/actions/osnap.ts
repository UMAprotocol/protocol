import assert from "assert";
import { Actions, Json, ActionCall } from "../../types";
import { TenderlyApi } from "../../libs/osnap/utils";
import type { OsnapPluginData } from "../../libs/osnap/interfaces";

type Config = {
  tenderly: TenderlyApi;
};

export function Handlers(config: Config): Actions {
  const { tenderly } = config;

  const actions: Actions = {
    async ping() {
      return "pong";
    },
    async simulate(space: OsnapPluginData) {
      return tenderly.simulateOsnapTx(space);
    },
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
