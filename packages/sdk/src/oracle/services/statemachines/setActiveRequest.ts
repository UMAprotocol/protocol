import { Update } from "../update";
import Store from "../../store";
import { Inputs } from "../../types/state";
import { Handlers as GenericHandlers } from "../../types/statemachine";

// required exports for state machine
export type Params = Inputs["request"];
export type Memory = { error?: Error };
export function initMemory(): Memory {
  return {};
}
export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory) {
      store.write((write) => write.inputs().request(params));

      try {
        // these could fail at any point if user isnt set, but thats ok, state machine will catch error, and use can inspect.
        // this will rerun when user is set.
        await update.oracle();
        await update.request();
        await update.collateralProps();
        // order is important, these should be last because they depend on user being set
        await update.userCollateralBalance();
        await update.oracleAllowance();
      } catch (err) {
        // its ok to ignore these errors
        memory.error = (err as unknown) as Error;
      }

      // set state flags after everything updates
      update.flags();
      return "done";
    },
  };
}
