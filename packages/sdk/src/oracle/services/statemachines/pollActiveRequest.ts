// this should only run as a single instance, will continue updating the active request as needed.
// this is a single poller for requests on all chains
import { Update } from "../update";
import Store from "../../store";
import { RequestState } from "../../types/state";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ContextClient } from "./utils";
import { ignoreExistenceErrorAsync } from "../../errors";

// required exports for state machine
export type Params = undefined;
export type Memory = { iterations: number };
export function initMemory(): Memory {
  return { iterations: 0 };
}
export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory, ctx: ContextClient): Promise<void | undefined> {
      const request = await ignoreExistenceErrorAsync(store.read().request);
      // requests can change externally if not already in one of these states
      const shouldUpdate = request && request.state !== RequestState.Invalid && request.state !== RequestState.Settled;

      if (shouldUpdate) {
        await update.request();
        // count how many times we have updated this request as a sanity check
        memory.iterations++;
      }

      const { checkTxIntervalSec = 30 } = (await ignoreExistenceErrorAsync(store.read().chainConfig)) || {};
      return ctx.sleep(checkTxIntervalSec * 1000);
    },
  };
}
