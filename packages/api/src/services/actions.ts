import assert from "assert";
import { Json, Actions, Libs } from "..";

export function Handlers(config: Json, libs: Libs): Actions {
  const actions: Actions = {
    echo(...args: Json[]) {
      return args;
    },
    listEmpAddresses() {
      return [...libs.registeredEmps.values()];
    },
    lastBlock() {
      return libs.lastBlock;
    },
    async listActiveEmps() {
      return libs.emps.active.values();
    },
    async listExpiredEmps() {
      return libs.emps.expired.values();
    },
    async sliceBlocks(start = -1, end?: number) {
      const blocks = await libs.blocks.values();
      return blocks.slice(start, end);
    },
  };

  // list all available actions
  const keys = Object.keys(actions);
  actions.actions = () => keys;

  return actions;
}
export default (config: Json, libs: Libs) => {
  const actions = Handlers(config, libs);
  return async (action: string, ...args: Json[]) => {
    assert(actions[action], `Invalid action: ${action}`);
    return actions[action](...args);
  };
};
