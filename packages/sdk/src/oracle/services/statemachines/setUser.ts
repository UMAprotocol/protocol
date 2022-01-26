import { Update } from "../update";
import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { User } from "../../types/state";

// require exports for a new context handler
export type Params = Partial<User>;
export type Memory = { error?: Error };

export function initMemory(): Memory {
  return {};
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory) {
      store.write((write) => write.inputs().user().set(params));

      try {
        // these will fail if request is not set, but thats ok because statemachine will catch and log and re-run once set
        await update.userCollateralBalance();
        await update.oracleAllowance();
      } catch (err) {
        // its ok to ignore these errors
        memory.error = (err as unknown) as Error;
      }
      return "done";
    },
  };
}
