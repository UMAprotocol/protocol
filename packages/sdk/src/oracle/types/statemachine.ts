import type { ContextClient } from "../services/statemachines/utils";

// memory can be any non primitive type or undefined
// eslint-disable-next-line
export type Memory = object | undefined;

export enum ContextType {
  setUser = "setUser",
  setActiveRequest = "setActiveRequest",
  approve = "approve",
  clearUser = "clearUser",
  disputePrice = "disputePrice",
  proposePrice = "proposePrice",
  switchOrAddChain = "switchOrAddChain",
  pollActiveRequest = "pollActiveRequest",
  pollActiveUser = "pollActiveUser",
  fetchPastEvents = "fetchPastEvents",
  pollNewEvents = "pollNewEvents",
  setActiveRequestByTransaction = "setActiveRequestByTransaction",
  settle = "settle",
  updateActiveRequest = "updateActiveRequest",
  fetchEventBased = "fetchEventBased",
}

export type ContextProps = {
  id: string;
  user?: string;
  type: ContextType;
  state: "done" | "error" | string;
  done: boolean;
  created: number;
  updated?: number;
  error?: Error;
  sleep?: number;
};

export type Context<P = undefined, M extends Memory = undefined> = ContextProps & {
  memory: M;
  params: P;
};

export type Handler<P = undefined, M extends Memory = undefined> = (
  params: P,
  memory: M,
  client: ContextClient
) => string | undefined | void | Promise<string | undefined | void>;

export type Handlers<P = undefined, M extends Memory = undefined> = Record<string, Handler<P, M>> & {
  start: Handler<P, M>;
};

export type Step<P = undefined, M extends Memory = undefined> = (
  context: Context<P, M>,
  now: number
) => Promise<Context<P, M>>;

export type Emit<P = undefined, M extends Memory = undefined> = (context: Context<P, M>) => void;
