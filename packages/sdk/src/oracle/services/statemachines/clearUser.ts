import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";

// require exports for a new context handler
export type Params = undefined;
export type Memory = undefined;

export function initMemory(): Memory {
  return undefined;
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  return {
    async start() {
      store.write((write) => {
        write.inputs().user().clear();
      });
      return "done";
    },
  };
}
