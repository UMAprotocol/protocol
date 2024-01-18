import assert from "assert";
import { Actions, Json, ActionCall } from "../../types";
import { simulateOsnapProposal } from "../../libs/osnap/utils";

export function Handlers(): Actions {
  const actions: Actions = {
    async ping() {
      return "pong";
    },
    simulate: simulateOsnapProposal,
  };

  // list all available actions
  const keys = Object.keys(actions);
  actions.actions = () => keys;

  return actions;
}

export default (): ActionCall => {
  const actions = Handlers();
  return async (action: string, ...args: Json[]): Promise<Json> => {
    assert(actions[action], `Invalid action: ${action}`);
    return actions[action](...args);
  };
};
