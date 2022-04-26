import { Update } from "../update";
import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ignoreExistenceErrorAsync } from "../../errors";

// required exports for state machine
export type Params = undefined;
export type Memory = undefined;
export function initMemory(): Memory {
  return undefined;
}
export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start() {
      const has = store.has();
      // we can ignore errors where reads fail, but all other errors will propogate
      // this will rerun when user is set.
      if (!has.defaultLiveness()) {
        await ignoreExistenceErrorAsync(update.oracle);
      }

      await ignoreExistenceErrorAsync(update.request);

      if (!has.collateralProps()) {
        await ignoreExistenceErrorAsync(update.collateralProps);
      }

      return "done";
    },
  };
}
