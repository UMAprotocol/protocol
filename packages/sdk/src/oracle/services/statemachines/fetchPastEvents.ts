// this will attempt to fetch all events down to startBlock in descending order. It will try to reduce the
// range of blocks queried to prevent errors with the provider. This can sometimes lead to really long query times
// for providers on chains which are very restrictive about block range.
// Normally you want to query events in order, ie oldest to newest, but in this case we want to prioritize the
// newest requests first in the case we cant fetch the whole range. Also we will store all events in order and
// process them on each iteration, so we should always have a consistent view of request with our currently known events.
import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ContextClient } from "./utils";
import { Update } from "../update";
import { rangeStart, rangeSuccessDescending, rangeFailureDescending, RangeState } from "../../utils";
import { ignoreExistenceErrorAsync } from "../../errors";

export type Params = {
  chainId: number;
  startBlock?: number;
  endBlock?: number;
  maxRange?: number;
};

export type Memory = { error?: Error; state?: RangeState; iterations: number };

export function initMemory(): Memory {
  return { iterations: 0 };
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory, ctx: ContextClient) {
      const provider = store.read().provider(params.chainId);
      const { chainId, startBlock = 0, endBlock = await provider.getBlockNumber(), maxRange } = params;

      memory.error = undefined;
      // we use this wierd range thing because in the case we cant query the entire block range due to provider error
      // we want to move start block closer to endblock to reduce the range until it stops erroring. These range functions
      // will do that for us.
      const rangeState = memory.state || rangeStart({ startBlock, endBlock, maxRange });
      const { currentStart, currentEnd } = rangeState;

      try {
        // this just queries events between start and end
        await update.oracleEvents(chainId, currentStart, currentEnd);
        // reprocess all known events and create a table of requests from it
        await update.sortedRequests(chainId);

        // try to update the active request by event data
        await ignoreExistenceErrorAsync(update.activeRequestFromEvents);

        // we signal that the current range was a success, now move currentStart, currentEnd accordingly
        // we set multiplier to 1 so we dont grow the range on success, this tends to create more errors and slow down querying
        memory.state = rangeSuccessDescending({ ...rangeState, multiplier: 1 });
      } catch (err) {
        memory.error = (err as unknown) as Error;
        // the provider threw an error so we will reduce our range by moving startblock closer to endblock next iteration
        memory.state = rangeFailureDescending(rangeState);
      }
      memory.iterations++;
      // the range functions will tell us when we have successfully queried the entire range of blocks.
      if (memory?.state?.done) return "done";
      // sleep to let other contexts run, but just resume right after.
      return ctx.sleep(100);
    },
  };
}
