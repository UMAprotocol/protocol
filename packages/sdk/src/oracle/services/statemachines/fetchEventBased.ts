import bluebird from "bluebird";
import { Update } from "../update";
import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ContextClient } from "./utils";

// required exports for state machine
export type Params = {
  chainId: number;
  concurrency?: number;
  pollRateSec?: number;
};

export type Memory = undefined;

export function initMemory(): Memory {
  return undefined;
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory, ctx: ContextClient): Promise<void | undefined> {
      const { chainId, pollRateSec = 15, concurrency = 5 } = params;
      const oracle = store.read().oracleService(chainId);
      const requests = oracle.listRequests();
      const requestsToFetch = requests.filter((request) => request.eventBased === undefined);
      await bluebird.map(requestsToFetch, (request) => update.request(request), { concurrency });
      return ctx.sleep(pollRateSec * 1000);
    },
  };
}
