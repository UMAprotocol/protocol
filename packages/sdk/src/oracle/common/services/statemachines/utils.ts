import assert from "assert";
import uid from "lodash/uniqueId";

import { Handlers, Memory, Context, Step as StepType, ContextProps, ContextType } from "../../types/statemachine";

// client to pass into handlers to allow them to modify context
export class ContextClient {
  constructor(private context: ContextProps) {}
  sleep(ms?: number): void {
    this.context.sleep = ms;
  }
}

export const Step = <P = undefined, M extends Memory = undefined>(handlers: Handlers<P, M>): StepType<P, M> => async (
  context: Context<P, M>,
  now: number
): Promise<Context<P, M>> => {
  assert(!context.done, "Context has ended");
  assert(handlers[context.state], "No handler for state: " + context.state);
  // conext is read only for some reason, have to copy it
  const copy = Object.assign({}, context);

  try {
    // remove sleep, assume it should be reset if needed
    if (copy.sleep) copy.sleep = undefined;
    const handler = handlers[copy.state];
    // have to copy this out because memory becomes read only for some reason?
    const memory = Object.assign({}, copy.memory);
    // handlers take in params and return a new state or nothin
    const state = await handler(copy.params, memory, new ContextClient(copy));
    copy.memory = memory;
    // update context state
    if (state) copy.state = state;
    // check for done
    if (state === "done") copy.done = true;
  } catch (err) {
    return {
      ...copy,
      error: err as Error,
      state: "error",
      done: true,
      updated: now,
    };
  }
  copy.updated = now;
  return copy;
};

export function shouldStep(context: Context<unknown, unknown & Memory> | undefined, now: number): context is Context {
  if (!context) return false;
  if (context.done) return false;
  if (context.updated === undefined) return true;
  if (!context?.sleep) return true;
  return now - context.updated >= context.sleep;
}

export function create<P, M extends Memory>(
  type: ContextType,
  params: P,
  memory: M,
  override: Partial<ContextProps> = {},
  now = Date.now()
): Context<P, M> {
  const context: Context<P, M> = {
    id: uid(type + "_"),
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
  return context;
}

export class ContextManager<P, M extends Memory> {
  constructor(
    private type: ContextType,
    private handlers: Handlers<P, M>,
    private initMemory: (params: P) => M,
    private emit: (ctx: Context<P, M>) => void
  ) {}
  create = (params: P, user?: string): string => {
    const context = create<P, M>(this.type, params, this.initMemory(params), { user });
    this.emit(context);
    return context.id;
  };
  // this step function will keep looping until either the state machine is done transitioning, or sleep has been specified
  async step(context: Context<P, M>, now: number = Date.now(), iterations = 10): Promise<Context<P, M>> {
    const step = Step<P, M>(this.handlers);
    let next = context;
    while (shouldStep(next, now)) {
      assert(
        iterations >= 0,
        "Infinite loop detected in state machine, make sure it each state transitions to done: " + context.type
      );
      next = await step(next, now);
      iterations--;
    }
    return next;
  }
}
