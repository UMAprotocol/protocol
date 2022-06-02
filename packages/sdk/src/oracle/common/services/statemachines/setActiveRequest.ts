import { interfaces } from "../../types";
import { Inputs } from "../../types/state";
import { Handlers as GenericHandlers } from "../../types/statemachine";

// required exports for state machine
export type Params = Inputs["request"];
export type Memory = undefined;
export function initMemory(): Memory {
  return undefined;
}
export function Handlers<S, O, E>(store: interfaces.Store<S, O, E>): GenericHandlers<Params, Memory> {
  return {
    async start(params: Params) {
      store.write((write) => write.inputs().request(params));
      return "done";
    },
  };
}
