export interface Store<I, D> {
  get: (id: I) => Promise<D | undefined>;
  set: (id: I, data: D) => Promise<void>;
  delete: (id: I) => Promise<void>;
  has: (id: I) => Promise<boolean>;
  entries?: () => Promise<Array<[I, D]>>;
  values?: () => Promise<Array<D>>;
  keys?: () => Promise<Array<I>>;
}
