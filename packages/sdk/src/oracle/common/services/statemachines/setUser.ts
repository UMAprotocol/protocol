import { Handlers as GenericHandlers } from "../../types/statemachine";
import { User } from "../../types/state";
import { ignoreExistenceErrorAsync } from "../../errors";
import { Store } from "../../types/interfaces";

// require exports for a new context handler
export type Params = Partial<User>;
export type Memory = undefined;

export function initMemory(): Memory {
  return undefined;
}

export function Handlers<S, O, E>(store: Store<S, O, E>): GenericHandlers<Params, Memory> {
  const { update } = store;
  return {
    async start(params: Params) {
      store.write((write) => write.inputs().user().set(params));

      // ignore erorrs caused by data not existing on reads, pass through other errors
      await ignoreExistenceErrorAsync(update.userCollateralBalance);
      await ignoreExistenceErrorAsync(update.oracleAllowance);

      return "done";
    },
  };
}
