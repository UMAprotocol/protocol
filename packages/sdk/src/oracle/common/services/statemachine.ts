import { Context, Memory, ContextType } from "../types/statemachine";
import { ContextManager, shouldStep } from "../services/statemachines/utils";
import { interfaces } from "../types";

// context types, import new ones here
import * as setUser from "./statemachines/setUser";
import * as clearUser from "./statemachines/clearUser";
import * as setActiveRequest from "./statemachines/setActiveRequest";
import * as approve from "./statemachines/approve";
import * as disputePrice from "./statemachines/disputePrice";
import * as proposePrice from "./statemachines/proposePrice";
import * as switchOrAddChain from "./statemachines/switchOrAddChain";
import * as pollActiveRequest from "./statemachines/pollActiveRequest";
import * as pollActiveUser from "./statemachines/pollActiveUser";
import * as fetchPastEvents from "./statemachines/fetchPastEvents";
import * as pollNewEvents from "./statemachines/pollNewEvents";
import * as updateActiveRequest from "./statemachines/updateActiveRequest";
import * as settle from "./statemachines/settle";
import * as setActiveRequestByTransaction from "./statemachines/setActiveRequestByTransaction";

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
type Handlers = Partial<{
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
}>;
export class StateMachine<S, O, E> {
  private pending: Context<unknown, unknown & Memory>[] = [];
  public types: Handlers;
  constructor(private store: interfaces.Store<S, O, E>) {
    // need to initizlie state types here manually for each new context type
    this.types = {};
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
  public create = <P>(type: ContextType, params: P, user?: string): string => {
    // assert(this.types[type],'Cannot create ' + type)
    const run = this.types[type];
    if (run) {
      // impossible to call this create function without typescript complaining unless you
      // enumerate every single type. that gets really old, so we cast params as the type it expects
      return run.create(params as never, user);
    }
    throw new Error("Unable to create context for: " + type);
  };
  public registerHandler = (type: ContextType): void => {
    const store = this.store;
    switch (type) {
      case ContextType.setUser: {
        this.types[type] = new ContextManager<setUser.Params, setUser.Memory>(
          ContextType.setUser,
          setUser.Handlers(store),
          setUser.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.clearUser: {
        this.types[type] = new ContextManager<clearUser.Params, clearUser.Memory>(
          ContextType.clearUser,
          clearUser.Handlers(store),
          clearUser.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.setActiveRequest: {
        this.types[type] = new ContextManager<setActiveRequest.Params, setActiveRequest.Memory>(
          ContextType.setActiveRequest,
          setActiveRequest.Handlers(store),
          setActiveRequest.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.approve: {
        this.types[type] = new ContextManager<approve.Params, approve.Memory>(
          ContextType.approve,
          approve.Handlers(store),
          approve.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.disputePrice: {
        this.types[type] = new ContextManager<disputePrice.Params, disputePrice.Memory>(
          ContextType.disputePrice,
          // no way to narrow the type of the generic store to make this call acceptable.
          // dispute price requires a specific oracle contract, but its unknown how to assert
          // this as true when registering the handler.
          disputePrice.Handlers(store as any),
          disputePrice.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.proposePrice: {
        this.types[type] = new ContextManager<proposePrice.Params, proposePrice.Memory>(
          ContextType.proposePrice,
          // no way to narrow the type of the generic store to make this call acceptable.
          // dispute price requires a specific oracle contract, but its unknown how to assert
          // this as true when registering the handler.
          proposePrice.Handlers(store as any),
          proposePrice.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.switchOrAddChain: {
        this.types[type] = new ContextManager<switchOrAddChain.Params, switchOrAddChain.Memory>(
          ContextType.switchOrAddChain,
          switchOrAddChain.Handlers(store),
          switchOrAddChain.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.pollActiveRequest: {
        this.types[type] = new ContextManager<pollActiveRequest.Params, pollActiveRequest.Memory>(
          ContextType.pollActiveRequest,
          pollActiveRequest.Handlers(store),
          pollActiveRequest.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.pollActiveUser: {
        this.types[type] = new ContextManager<pollActiveUser.Params, pollActiveUser.Memory>(
          ContextType.pollActiveUser,
          pollActiveUser.Handlers(store),
          pollActiveUser.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.fetchPastEvents: {
        this.types[type] = new ContextManager<fetchPastEvents.Params, fetchPastEvents.Memory>(
          ContextType.fetchPastEvents,
          fetchPastEvents.Handlers(store),
          fetchPastEvents.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.pollNewEvents: {
        this.types[type] = new ContextManager<pollNewEvents.Params, pollNewEvents.Memory>(
          ContextType.pollNewEvents,
          pollNewEvents.Handlers(store),
          pollNewEvents.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.setActiveRequestByTransaction: {
        this.types[type] = new ContextManager<
          setActiveRequestByTransaction.Params,
          setActiveRequestByTransaction.Memory
        >(
          ContextType.setActiveRequestByTransaction,
          setActiveRequestByTransaction.Handlers(store),
          setActiveRequestByTransaction.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.settle: {
        this.types[type] = new ContextManager<settle.Params, settle.Memory>(
          ContextType.settle,
          // no way to narrow the type of the generic store to make this call acceptable.
          // dispute price requires a specific oracle contract, but its unknown how to assert
          // this as true when registering the handler.
          settle.Handlers(store as any),
          settle.initMemory,
          this.handleCreate
        );
        break;
      }
      case ContextType.updateActiveRequest: {
        this.types[type] = new ContextManager<updateActiveRequest.Params, updateActiveRequest.Memory>(
          ContextType.updateActiveRequest,
          updateActiveRequest.Handlers(store),
          updateActiveRequest.initMemory,
          this.handleCreate
        );
        break;
      }
    }
  };
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
      const run = this.types[context.type];
      if (run) {
        // impossible to call this step function without typescript complaining unless you
        // enumerate every single type. that gets really old, so we cast params as the type it expects
        next = await run.step(context as never, now);
        if (!next.done) {
          this.push(next);
        }
        this.saveContext(next);
      } else {
        throw new Error("Invalid context type: " + context.type);
      }
    }
    return this.size() > 0;
  };
}
