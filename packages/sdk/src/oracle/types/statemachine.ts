// memory can be any non primitive type or undefined
// eslint-disable-next-line
export type Memory = object | undefined;

export enum ContextType {
  setUser = "setUser",
  setActiveRequest = "setActiveRequest",
}

export type ContextProps = {
  id: string;
  type: ContextType;
  state: "done" | "error" | string;
  done: boolean;
  created: number;
  updated: number | undefined;
  error?: Error;
  interval?: number;
};

export type Context<P = undefined, M extends Memory = undefined> = ContextProps & {
  memory: M;
  params: P;
};
export type Handler<P = undefined, M extends Memory = undefined> = (
  params: P,
  memory: M
) => string | undefined | Promise<string> | Promise<undefined>;
export type Handlers<P = undefined, M extends Memory = undefined> = Record<string, Handler<P, M>> & {
  start: Handler<P, M>;
};
export type Step<P = undefined, M extends Memory = undefined> = (
  context: Context<P, M>,
  now: number
) => Promise<Context<P, M>>;

export type Emit<P = undefined, M extends Memory = undefined> = (context: Context<P, M>) => void;
