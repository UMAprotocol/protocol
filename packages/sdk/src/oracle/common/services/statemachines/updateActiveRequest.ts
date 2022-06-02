import { interfaces } from "../../types";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ignoreExistenceErrorAsync } from "../../errors";

// required exports for state machine
export type Params = undefined;
export type Memory = undefined;
export function initMemory(): Memory {
  return undefined;
}
export function Handlers<S, O, E>(store: interfaces.Store<S, O, E>): GenericHandlers<Params, Memory> {
  const { update } = store;
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
