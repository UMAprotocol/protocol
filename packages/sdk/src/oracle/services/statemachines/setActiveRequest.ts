import { Update } from "../update";
import Store from "../../store";
import { Inputs } from "../../types/state";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ignoreExistenceErrorAsync } from "../../errors";

// required exports for state machine
export type Params = Inputs["request"];
export type Memory = undefined;
export function initMemory(): Memory {
  return undefined;
}
export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params) {
      store.write((write) => write.inputs().request(params));

      // we can ignore errors where reads fail, but all other errors will propogate
      // this will rerun when user is set.
      await ignoreExistenceErrorAsync(update.oracle);

      // get current time of chain when switching request
      await ignoreExistenceErrorAsync(update.currentTime);
      await ignoreExistenceErrorAsync(update.request);
      await ignoreExistenceErrorAsync(update.collateralProps);
      // order is important, these should be last because they depend on user being set
      await ignoreExistenceErrorAsync(update.userCollateralBalance);
      await ignoreExistenceErrorAsync(update.oracleAllowance);

      return "done";
    },
  };
}
