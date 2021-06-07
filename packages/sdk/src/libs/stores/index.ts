export { default as JsMap } from "./js-map";
export { default as SortedJsMap } from "./sorted-js-map";
export { default as GoogleDatastore } from "./google-datastore";

// types
export interface Store<I, D> {
  get: (id: I) => Promise<D | undefined>;
  set: (id: I, data: D) => Promise<void>;
  delete: (id: I) => Promise<void>;
  has: (id: I) => Promise<boolean>;
  entries: () => Promise<Array<[I, D]>>;
  values: () => Promise<Array<D>>;
  keys: () => Promise<Array<I>>;
  size: () => Promise<number>;
  clear: () => Promise<void>;
  // these fields are for stores with sorted data
  between: (a: I, b: I) => Promise<Array<D>>;
  slice: (id: I, length: number) => Promise<Array<D>>;
  driver?: any;
}
