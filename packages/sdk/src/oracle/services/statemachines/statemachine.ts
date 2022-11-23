import { Context, Memory, ContextType } from "../../types/statemachine";
import type Store from "../../store";
import { ContextManager, shouldStep } from "./utils";

// context types, import new ones here
import * as setUser from "./setUser";
import * as clearUser from "./clearUser";
import * as setActiveRequest from "./setActiveRequest";
import * as approve from "./approve";
import * as disputePrice from "./disputePrice";
import * as proposePrice from "./proposePrice";
import * as switchOrAddChain from "./switchOrAddChain";
import * as pollActiveRequest from "./pollActiveRequest";
import * as pollActiveUser from "./pollActiveUser";
import * as fetchPastEvents from "./fetchPastEvents";
import * as pollNewEvents from "./pollNewEvents";
import * as updateActiveRequest from "./updateActiveRequest";
import * as settle from "./settle";
import * as setActiveRequestByTransaction from "./setActiveRequestByTransaction";
import * as fetchEventBased from "./fetchEventBased";

/**
 * StateMachine. This class will be used to handle all change requests by the user, including setting state which
 * may require triggering fetching data from chain, or initiating transactions that require tracking.
 *
 * This class is meant to step through states of a Context object. This object can have variable
 * parameters and memory. There are several concepts to understand before using this class:
 *
 * 1. Handlers - This is the state machine state handlers, it is an objected keyed by each state, with a function handler.
 * 2. Params - These are common parameters set by the caller, passed into each handler function.
 * 3. Memory - This is a writing space within the state machine handlers that accumulates through states.
 * 4. Context - This is the sum of all data needed to transition through the state machine states. It includes params, memory and metadata about the runtime.
 * 5. Context.done - This is a special property on context.done which represents that the state machine is done transitioning this context.
 * 6. Context.state = "done" - This is a reserved state on context.state, if set to "done" its the same thing as done = true.
 * 7. Context.state = "error" - This is a reserved state on context.state, if set to "error" it means the context is done, but also there is an context.error object.
 * 8. Interval - This is a property on the context which specifies the maximum rate in MS this context will transition, based on the current timestamp.
 */
export class StateMachine {
  private pending: Context<unknown, unknown & Memory>[] = [];
  // this needs to be updated when adding new context type
  public types: {
    [ContextType.setUser]: ContextManager<setUser.Params, setUser.Memory>;
    [ContextType.clearUser]: ContextManager<clearUser.Params, clearUser.Memory>;
    [ContextType.setActiveRequest]: ContextManager<setActiveRequest.Params, setActiveRequest.Memory>;
    [ContextType.approve]: ContextManager<approve.Params, approve.Memory>;
    [ContextType.disputePrice]: ContextManager<disputePrice.Params, disputePrice.Memory>;
    [ContextType.proposePrice]: ContextManager<proposePrice.Params, proposePrice.Memory>;
    [ContextType.switchOrAddChain]: ContextManager<switchOrAddChain.Params, switchOrAddChain.Memory>;
    [ContextType.pollActiveRequest]: ContextManager<pollActiveRequest.Params, pollActiveRequest.Memory>;
    [ContextType.pollActiveUser]: ContextManager<pollActiveUser.Params, pollActiveUser.Memory>;
    [ContextType.fetchPastEvents]: ContextManager<fetchPastEvents.Params, fetchPastEvents.Memory>;
    [ContextType.pollNewEvents]: ContextManager<pollNewEvents.Params, pollNewEvents.Memory>;
    [ContextType.setActiveRequestByTransaction]: ContextManager<
      setActiveRequestByTransaction.Params,
      setActiveRequestByTransaction.Memory
    >;
    [ContextType.settle]: ContextManager<settle.Params, settle.Memory>;
    [ContextType.updateActiveRequest]: ContextManager<updateActiveRequest.Params, updateActiveRequest.Memory>;
    [ContextType.fetchEventBased]: ContextManager<fetchEventBased.Params, fetchEventBased.Memory>;
  };
  constructor(private store: Store) {
    // need to initizlie state types here manually for each new context type
    this.types = {
      [ContextType.setUser]: new ContextManager<setUser.Params, setUser.Memory>(
        ContextType.setUser,
        setUser.Handlers(store),
        setUser.initMemory,
        this.handleCreate
      ),
      [ContextType.clearUser]: new ContextManager<clearUser.Params, clearUser.Memory>(
        ContextType.clearUser,
        clearUser.Handlers(store),
        clearUser.initMemory,
        this.handleCreate
      ),
      [ContextType.setActiveRequest]: new ContextManager<setActiveRequest.Params, setActiveRequest.Memory>(
        ContextType.setActiveRequest,
        setActiveRequest.Handlers(store),
        setActiveRequest.initMemory,
        this.handleCreate
      ),
      [ContextType.approve]: new ContextManager<approve.Params, approve.Memory>(
        ContextType.approve,
        approve.Handlers(store),
        approve.initMemory,
        this.handleCreate
      ),
      [ContextType.disputePrice]: new ContextManager<disputePrice.Params, disputePrice.Memory>(
        ContextType.disputePrice,
        disputePrice.Handlers(store),
        disputePrice.initMemory,
        this.handleCreate
      ),
      [ContextType.proposePrice]: new ContextManager<proposePrice.Params, proposePrice.Memory>(
        ContextType.proposePrice,
        proposePrice.Handlers(store),
        proposePrice.initMemory,
        this.handleCreate
      ),
      [ContextType.switchOrAddChain]: new ContextManager<switchOrAddChain.Params, switchOrAddChain.Memory>(
        ContextType.switchOrAddChain,
        switchOrAddChain.Handlers(store),
        switchOrAddChain.initMemory,
        this.handleCreate
      ),
      [ContextType.pollActiveRequest]: new ContextManager<pollActiveRequest.Params, pollActiveRequest.Memory>(
        ContextType.pollActiveRequest,
        pollActiveRequest.Handlers(store),
        pollActiveRequest.initMemory,
        this.handleCreate
      ),
      [ContextType.pollActiveUser]: new ContextManager<pollActiveUser.Params, pollActiveUser.Memory>(
        ContextType.pollActiveUser,
        pollActiveUser.Handlers(store),
        pollActiveUser.initMemory,
        this.handleCreate
      ),
      [ContextType.fetchPastEvents]: new ContextManager<fetchPastEvents.Params, fetchPastEvents.Memory>(
        ContextType.fetchPastEvents,
        fetchPastEvents.Handlers(store),
        fetchPastEvents.initMemory,
        this.handleCreate
      ),
      [ContextType.pollNewEvents]: new ContextManager<pollNewEvents.Params, pollNewEvents.Memory>(
        ContextType.pollNewEvents,
        pollNewEvents.Handlers(store),
        pollNewEvents.initMemory,
        this.handleCreate
      ),
      [ContextType.setActiveRequestByTransaction]: new ContextManager<
        setActiveRequestByTransaction.Params,
        setActiveRequestByTransaction.Memory
      >(
        ContextType.setActiveRequestByTransaction,
        setActiveRequestByTransaction.Handlers(store),
        setActiveRequestByTransaction.initMemory,
        this.handleCreate
      ),
      [ContextType.settle]: new ContextManager<settle.Params, settle.Memory>(
        ContextType.settle,
        settle.Handlers(store),
        settle.initMemory,
        this.handleCreate
      ),
      [ContextType.updateActiveRequest]: new ContextManager<updateActiveRequest.Params, updateActiveRequest.Memory>(
        ContextType.updateActiveRequest,
        updateActiveRequest.Handlers(store),
        updateActiveRequest.initMemory,
        this.handleCreate
      ),
      [ContextType.fetchEventBased]: new ContextManager<fetchEventBased.Params, fetchEventBased.Memory>(
        ContextType.fetchEventBased,
        fetchEventBased.Handlers(store),
        fetchEventBased.initMemory,
        this.handleCreate
      ),
    };
  }
  private saveContext(context: Context<unknown, unknown & Memory>) {
    this.store.write((w) => w.command(context));
  }
  private handleCreate = (context: Context<unknown, unknown & Memory>) => {
    this.push(context);
    this.saveContext(context);
  };

  // remove element from front of queue
  private shift(): Context<unknown, unknown & Memory> | undefined {
    return this.pending.shift();
  }
  // remove element from back of queue
  private pop(): Context<unknown, unknown & Memory> | undefined {
    return this.pending.pop();
  }
  private size(): number {
    return this.pending.length;
  }
  private push(context: Context<unknown, unknown & Memory>): void {
    this.pending.push(context);
  }
  /**
   * tick. Process all pending contexts, move them to done if needed
   *
   * @param {} now - Specify the timestamp this tick is running on.
   * @returns {Promise<boolean>} - Returns if there are still any pending contexts to run.
   */
  tick = async (now = Date.now()): Promise<boolean> => {
    const context = this.shift();
    // if this cant step, then push it to back of queue
    if (!shouldStep(context, now)) {
      context && !context.done && this.push(context);
      // if we can step, then step it and push result into queue
    } else {
      let next;
      switch (context.type) {
        // need to update this function with the new context processor
        case ContextType.setUser: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<setUser.Params, setUser.Memory>,
            now
          );
          break;
        }
        case ContextType.clearUser: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<clearUser.Params, clearUser.Memory>,
            now
          );
          break;
        }
        case ContextType.setActiveRequest: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<setActiveRequest.Params, setActiveRequest.Memory>,
            now
          );
          break;
        }
        case ContextType.approve: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<approve.Params, approve.Memory>,
            now
          );
          break;
        }
        case ContextType.disputePrice: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<disputePrice.Params, disputePrice.Memory>,
            now
          );
          break;
        }
        case ContextType.proposePrice: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<proposePrice.Params, proposePrice.Memory>,
            now
          );
          break;
        }
        case ContextType.switchOrAddChain: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<switchOrAddChain.Params, switchOrAddChain.Memory>,
            now
          );
          break;
        }
        case ContextType.pollActiveRequest: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<pollActiveRequest.Params, pollActiveRequest.Memory>,
            now
          );
          break;
        }
        case ContextType.pollActiveUser: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<pollActiveUser.Params, pollActiveUser.Memory>,
            now
          );
          break;
        }
        case ContextType.fetchPastEvents: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<fetchPastEvents.Params, fetchPastEvents.Memory>,
            now
          );
          break;
        }
        case ContextType.pollNewEvents: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<pollNewEvents.Params, pollNewEvents.Memory>,
            now
          );
          break;
        }
        case ContextType.setActiveRequestByTransaction: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<setActiveRequestByTransaction.Params, setActiveRequestByTransaction.Memory>,
            now
          );
          break;
        }
        case ContextType.settle: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<settle.Params, settle.Memory>,
            now
          );
          break;
        }
        case ContextType.updateActiveRequest: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<updateActiveRequest.Params, updateActiveRequest.Memory>,
            now
          );
          break;
        }
        case ContextType.fetchEventBased: {
          next = await this.types[context.type].step(
            (context as unknown) as Context<fetchEventBased.Params, fetchEventBased.Memory>,
            now
          );
          break;
        }
        default: {
          throw new Error("Unable to handle type: " + context.type);
        }
      }
      if (!next.done) {
        this.push(next);
      }
      this.saveContext(next);
    }

    return this.size() > 0;
  };
}
