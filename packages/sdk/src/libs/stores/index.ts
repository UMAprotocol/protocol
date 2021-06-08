export { default as JsMap } from "./js-map";
export { default as SortedJsMap } from "./sorted-js-map";
export { default as GoogleDatastore } from "./google-datastore";

// Base store interface which is inspired by JS map
export interface Store<Id, Data> {
  get: (id: Id) => Promise<Data | undefined>;
  set: (id: Id, data: Data) => Promise<void>;
  delete: (id: Id) => Promise<void>;
  has: (id: Id) => Promise<boolean>;
  entries: () => Promise<Array<[Id, Data]>>;
  values: () => Promise<Array<Data>>;
  keys: () => Promise<Array<Id>>;
  size: () => Promise<number>;
  clear: () => Promise<void>;
  // use this to expose the underlying database driver
  driver?: any;
}

// Sorted (ordered) key value with some extra queries
export interface SortedStore<Id, Data> extends Store<Id, Data> {
  // these fields are for stores with sorted data
  between: (a: Id, b: Id) => Promise<Array<Data>>;
  slice: (id: Id, length: number) => Promise<Array<Data>>;
}
