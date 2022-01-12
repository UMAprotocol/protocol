// memory can be any non primitive type or undefined
// eslint-disable-next-line
export type Memory = object | undefined;

export type ContextProps = {
  id: string;
  type: string;
  state: string;
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
export type Handler<P, M extends Memory> = (params: P, memory: M) => string | undefined;
export type Handlers<P, M extends Memory> = Record<string, Handler<P, M>>;
export type Emit<P, M extends Memory> = (context: Context<P, M>) => void;
