import type { Store } from "../index";

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
    return Array.from(map.entries());
  }
  async function values() {
    return Array.from(map.values());
  }
  async function keys() {
    return Array.from(map.keys());
  }
  async function size() {
    return map.size;
  }
  async function clear() {
    map.clear();
  }
  return {
    get,
    set,
    has,
    delete: del,
    entries,
    values,
    keys,
    size,
    clear,
  };
}
