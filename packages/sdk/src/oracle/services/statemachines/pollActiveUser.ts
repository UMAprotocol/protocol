import { Update } from "../update";
import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ContextClient } from "./utils";
import { ignoreError } from "../../utils";

export type Params = undefined;
export type Memory = { error?: Error; iterations: number };

export function initMemory(): Memory {
  return { iterations: 0 };
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory, ctx: ContextClient) {
      memory.error = undefined;
      try {
        // these will fail if request is not set, but thats ok because statemachine will catch and log and re-run once set
        await update.userCollateralBalance();
        await update.oracleAllowance();
      } catch (err) {
        // its ok to ignore these errors
        memory.error = (err as unknown) as Error;
      }
      memory.iterations++;
      // this is set differently for every chain
      const { checkTxIntervalSec = 30 } = ignoreError(store.read().chainConfig) || {};
      return ctx.sleep(checkTxIntervalSec * 1000);
    },
  };
}
