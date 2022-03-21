import { Update } from "../update";
import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ContextClient } from "./utils";
import { ignoreExistenceErrorAsync } from "../../errors";

export type Params = undefined;
export type Memory = { iterations: number };

export function initMemory(): Memory {
  return { iterations: 0 };
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory, ctx: ContextClient) {
      await ignoreExistenceErrorAsync(update.userCollateralBalance);
      await ignoreExistenceErrorAsync(update.oracleAllowance);
      memory.iterations++;
      // this is set differently for every chain
      const { checkTxIntervalSec = 30 } = (await ignoreExistenceErrorAsync(store.read().chainConfig)) || {};
      return ctx.sleep(checkTxIntervalSec * 1000);
    },
  };
}
