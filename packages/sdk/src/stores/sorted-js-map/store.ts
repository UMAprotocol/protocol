import { sortedIndex, sortedLastIndex } from "lodash";
import type { SortedStore } from "../index";
import { exists } from "../../utils";

// this class will basically give you similar functionality to a sorted key value store this is really useful for
// time series data, and JS does not have a native way to do this, but comes for free with most NoSql databases.
export default function <Id, Data>(): SortedStore<Id, Data> {
  const ids: Id[] = [];
  const map = new Map<Id, Data>();

  function getStart(id: Id, inclusive = true) {
    if (inclusive) {
      return sortedIndex(ids, id);
    } else {
      return sortedLastIndex(ids, id);
    }
  }
  function getEnd(id: Id, inclusive = false) {
    return getStart(id, !inclusive);
  }
  function del(id: Id) {
    const index = sortedIndex(ids, id);
    ids.splice(index, 1);
    const result = map.get(id);
    map.delete(id);
    return result;
  }
  // keeps typescript from complaining that return values may be undefined
  function getSafe(id: Id) {
    const result = map.get(id);
    if (exists(result)) return result;
    throw new Error("Missing data for index: " + id);
  }

  return {
    async has(id: Id) {
      return map.has(id);
    },
    async set(id: Id, data: Data) {
      if (map.has(id)) {
        map.set(id, data);
      } else {
        const index = sortedIndex(ids, id);
        ids.splice(index, 0, id);
        map.set(id, data);
      }
    },
    async get(id: Id) {
      return map.get(id);
    },
    async values() {
      return ids.map(getSafe);
    },
    async entries() {
      return ids.map((id) => [id, getSafe(id)]);
    },
    async keys() {
      return [...ids];
    },
    async clear() {
      map.clear();
      ids.length = 0;
    },
    async size() {
      return ids.length;
    },
    async delete(id: Id) {
      if (!map.has(id)) return;
      del(id);
    },
    // assume [a,b)
    async between(a: Id, b: Id) {
      const start = getStart(a);
      const end = getEnd(b);
      return ids.slice(start, end).map(getSafe);
    },
    async slice(id: Id, length: number) {
      const start = getStart(id);
      return ids.slice(start, start + length).map(getSafe);
    },
  };
}
