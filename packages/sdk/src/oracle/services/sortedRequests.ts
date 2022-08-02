// this is a special service that works across all oracles type, chains, etc, to give a combined
// view of all requests across running instances.
import sortedIndex from "lodash/sortedIndex";
import sortedLastIndex from "lodash/sortedLastIndex";

import { exists } from "../../utils";
import { requestId } from "../utils";

import { InputRequestWithOracleType, RequestWithOracleType, RequestsWithOracleType } from "../types/state";

// this was copied out of store and made to be 1. a class, and 2. sync.  Could not modify old implementation since
// other services rely on this currently and it causes cascading refactors. This has been copied without modification to logic.
export class SortedStore<Id, Data> {
  private ids: Id[] = [];
  private map = new Map<Id, Data>();
  private getStart = (id: Id, inclusive = true): number => {
    if (inclusive) {
      return sortedIndex(this.ids, id);
    } else {
      return sortedLastIndex(this.ids, id);
    }
  };
  private getEnd = (id: Id, inclusive = false): number => {
    return this.getStart(id, !inclusive);
  };
  private del = (id: Id): Data | undefined => {
    const index = sortedIndex(this.ids, id);
    this.ids.splice(index, 1);
    const result = this.map.get(id);
    this.map.delete(id);
    return result;
  };
  // keeps typescript from complaining that return values may be undefined
  private getSafe = (id: Id): Data => {
    const result = this.map.get(id);
    if (exists(result)) return result;
    throw new Error("Missing data for index: " + id);
  };
  has = (id: Id): boolean => {
    return this.map.has(id);
  };
  set = (id: Id, data: Data): void => {
    if (this.map.has(id)) {
      this.map.set(id, data);
    } else {
      const index = sortedIndex(this.ids, id);
      this.ids.splice(index, 0, id);
      this.map.set(id, data);
    }
  };
  get = (id: Id): Data | undefined => {
    return this.map.get(id);
  };
  values = (): Data[] => {
    return this.ids.map(this.getSafe);
  };
  entries = (): [Id, Data][] => {
    return this.ids.map((id) => [id, this.getSafe(id)]);
  };
  keys = (): Id[] => {
    return [...this.ids];
  };
  clear = (): void => {
    this.map.clear();
    this.ids.length = 0;
  };
  size = (): number => {
    return this.ids.length;
  };
  delete = (id: Id): void => {
    if (!this.map.has(id)) return;
    this.del(id);
  };
  // assume [a,b)
  between = (a: Id, b: Id): Data[] => {
    const start = this.getStart(a);
    const end = this.getEnd(b);
    return this.ids.slice(start, end).map(this.getSafe);
  };
  slice = (id: Id, length: number): Data[] => {
    const start = this.getStart(id);
    return this.ids.slice(start, start + length).map(this.getSafe);
  };
}

// this sorts requests across all chains and oracles
export class SortedRequests extends SortedStore<string, RequestWithOracleType> {
  setByRequest(value: InputRequestWithOracleType): void {
    return this.set(this.id(value), value);
  }
  descending(): RequestsWithOracleType {
    // sadly you cannot control lodash sorting descending, so reverse is necessary
    return this.values().reverse();
  }
  ascending(): RequestsWithOracleType {
    return this.values();
  }
  getByRequest(request: InputRequestWithOracleType): RequestWithOracleType {
    // always return at least the original query data
    return this.get(this.id(request)) || request;
  }
  id(request: InputRequestWithOracleType): string {
    return requestId(request) + "!" + request.chainId + "!" + request.oracleType;
  }
}
