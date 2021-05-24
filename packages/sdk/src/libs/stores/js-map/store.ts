import type { Store } from "../index.d";
export default function <I, D>(map: Map<I, D> = new Map<I, D>()): Store<I, D> {
  async function get(id: I) {
    return map.get(id);
  }
  async function set(id: I, data: D) {
    map.set(id, data);
  }
  async function has(id: I) {
    return map.has(id);
  }
  async function del(id: I) {
    map.delete(id);
  }
  async function entries() {
    return [...map.entries()];
  }
  async function values() {
    return [...map.values()];
  }
  async function keys() {
    return [...map.keys()];
  }

  return {
    get,
    set,
    has,
    delete: del,
    entries,
    values,
    keys,
  };
}
