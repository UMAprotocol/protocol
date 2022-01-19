import assert from "assert";
import uid from "lodash/uniqueId";

import { Handlers, Memory, Context, Step as StepType, ContextProps, ContextType } from "../../types/statemachine";

export const Step = <P = undefined, M extends Memory = undefined>(handlers: Handlers<P, M>): StepType<P, M> => async (
  context: Context<P, M>,
  now: number
): Promise<Context<P, M>> => {
  assert(!context.done, "Context has ended");
  assert(handlers[context.state], "No handler for state: " + context.state);
  // conext is read only for some reason, have to copy it
  const copy = Object.assign({}, context);
  try {
    const handler = handlers[copy.state];
    // have to copy this out because memory becomes read only for some reason?
    const memory = Object.assign({}, copy.memory);
    // handlers take in params and return a new state or nothin
    const state = await handler(copy.params, memory);
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
  if (context.updated === undefined) return true;
  if (!context?.interval) return true;
  return now - context.updated >= context.interval;
}

export function create<P, M extends Memory>(
  type: ContextType,
  params: P,
  memory: M,
  override: Partial<ContextProps> = {},
  now = Date.now()
): Context<P, M> {
  const context: Context<P, M> = {
    id: uid("!" + type),
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
  public step: StepType<P, M>;
  constructor(
    private type: ContextType,
    private handlers: Handlers<P, M>,
    private initMemory: () => M,
    private emit: (ctx: Context<P, M>) => void
  ) {
    this.step = Step<P, M>(handlers);
  }
  create = (params: P) => {
    const context = create<P, M>(this.type, params, this.initMemory());
    this.emit(context);
    return context.id;
  };
}
