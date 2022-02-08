// this statemachine will continue to poll for new events from startBlock ( or latest block if not defined).
// It will maintain memory of the last block it polled for events up to, and use that as the start block for next
// iteration, while always querying up to the latest block.
import Store from "../../store";
import { Handlers as GenericHandlers } from "../../types/statemachine";
import { ContextClient } from "./utils";
import { Update } from "../update";

export type Params = {
  chainId: number;
  startBlock?: number;
  pollRateSec?: number;
};

export type Memory = { error?: Error; lastBlock?: number; iterations: number };

export function initMemory(): Memory {
  return { iterations: 0 };
}

export function Handlers(store: Store): GenericHandlers<Params, Memory> {
  const update = new Update(store);
  return {
    async start(params: Params, memory: Memory, ctx: ContextClient) {
      // start at the latest block, we have other command to get historical events
      const { chainId, startBlock, pollRateSec = 50 } = params;
      const provider = store.read().provider(chainId);
      const latestBlock = await provider.getBlockNumber();
      // our current block is the start block, or last known block we have queried up to
      const currentBlock = memory.lastBlock || startBlock || latestBlock;
      memory.error = undefined;
      try {
        // dont worry about querying if latest and current are the same. This optimization causes wierd effects
        // during testing, as block number rarely changes unless user moves it manually, giving the impression that events are missed.
        if (latestBlock !== currentBlock) {
          // this pulls all events from current to latest block
          await update.oracleEvents(chainId, currentBlock, latestBlock);
          // update our request table list with all known events
          await update.sortedRequests(chainId);

          try {
            // we can just try to update the current active request, we dont care if it fails, active request might not be set
            await update.activeRequestFromEvents();
          } catch (err) {
            // do nothing
          }

          // reset our last block seen to the latest (end) block
          memory.lastBlock = latestBlock;
          // just count how many successful iterations we do as a kind of sanity check
          memory.iterations++;
        }
      } catch (err) {
        // store an error for an iteration if we need to debug
        memory.error = (err as unknown) as Error;
      }

      // we dont need to poll these events very fast, so just set to once a min
      return ctx.sleep(pollRateSec * 1000);
    },
  };
}
