import assert from "assert";
import type { Context, Handlers, Memory, Emit, ContextProps } from "../types/statemachine";
import uid from "lodash/uniqueId";

export { Context, Handlers, Emit };

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
export class StateMachine<P = undefined, M extends Memory = undefined> {
  private pending: Record<string, Context<P, M>> = {};
  constructor(public type: string, private handlers: Handlers<P, M>, private emit: Emit<P, M>) {}
  private remove(id: string): void {
    delete this.pending[id];
  }
  private shouldStep(context: Context<P, M>, now: number): boolean {
    if (context.updated === undefined) return true;
    if (!context?.interval) return true;
    return now - context.updated >= context.interval;
  }
  public hasPending(): boolean {
    return Object.values(this.pending).length > 0;
  }
  private async step(context: Context<P, M>, now: number): Promise<Context<P, M>> {
    assert(!context.done, "Context has ended");
    try {
      assert(this.handlers[context.state], "No handler for state: " + context.state);
      const handler = this.handlers[context.state];
      // handlers take in params and return a new state or nothing
      const state = await handler(context.params, context.memory);

      // update context state
      if (state) context.state = state;
      // check for done
      if (state === "done") context.done = true;
    } catch (err) {
      context.error = err as Error;
      context.state = "error";
      context.done = true;
    }
    context.updated = now;
    return context;
  }
  /**
   * tick. Process all pending contexts, move them to done if needed
   *
   * @param {} now - Specify the timestamp this tick is running on.
   * @returns {Promise<boolean>} - Returns if there are still any pending contexts to run.
   */
  async tick(now = Date.now()): Promise<boolean> {
    for (const context of Object.values(this.pending)) {
      if (this.shouldStep(context, now)) {
        const next = await this.step(context, now);
        if (next.done) this.remove(context.id);
        this.emit(next);
      }
    }
    return this.hasPending();
  }
  /**
   * create. This creates a new context to run in the state machine.
   *
   * @param {P} params - User defined parameters needed to pass into the state handlers.
   * @param {M} memory - User defined memory needed to accumulate data to pass into state handlers.
   * @param {Partial} override - Override any of the default properties in the context, should not be used often.
   * @param {} now - Specify the current time as a number, by default Date.now();
   * @returns {string} - Returns the ID of this context.
   */
  create(params: P, memory: M, override: Partial<ContextProps> = {}, now = Date.now()): string {
    const { type } = this;
    const context: Context<P, M> = {
      id: uid(type),
      state: "start",
      done: false,
      updated: undefined,
      created: now,
      type,
      // override any part of the context, not recommended for most cases
      ...override,
      params,
      memory,
    };
    this.pending[context.id] = context;
    this.emit(context);
    return context.id;
  }
  /**
   * get. Lookup a context by id.
   *
   * @param {} id
   */
  get(id: string) {
    return this.pending[id];
  }
}
