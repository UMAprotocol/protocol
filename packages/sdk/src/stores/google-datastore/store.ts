import { exists } from "../../utils";
import type { SortedStore } from "..";
import { Datastore, Key } from "@google-cloud/datastore";
import highland from "highland";

// TODO: this is a work in progress which will be completed during datastore integration.
export default function <D>(kind: string, store: Datastore): SortedStore<string, D> {
  function makeKey(id: string): Key {
    return store.key([kind, id]);
  }
  // return value or undefined if it doesnt exist
  async function get(id: string) {
    try {
      const [result] = await store.get(makeKey(id));
      return result;
    } catch (err) {
      return;
    }
  }
  async function set(id: string, data: D) {
    await store.save({
      key: makeKey(id),
      method: "insert",
      data,
    });
  }
  async function has(id: string) {
    // horribly ineficient to actually query data to see if it exists, but cannot find a better way
    return exists(await get(id));
  }
  async function del(id: string) {
    await store.delete(makeKey(id));
  }
  async function entries() {
    const [results] = await store.createQuery(kind).run();
    return results.map((result) => {
      return [result[store.KEY].name, result];
    }) as [string, D][];
  }
  async function values() {
    const [results] = await store.createQuery(kind).run();
    return results;
  }
  // all this does is map over full entries to return the id of the entry. have not found a better way to query this.
  async function keys() {
    const [results] = await store.createQuery(kind).select("__key__").run();
    return results.map((result) => {
      return result[store.KEY].name;
    }) as string[];
  }
  // theres no way to really do built into the store client. Google recommends managing a size entry yourself.
  async function size(): Promise<number> {
    throw new Error("size not supported in google store");
  }
  // this actually queries all values, then batches them to delete N at a time. This is a horrible way
  // to do this, but I could not find a better way to "drop" all kinds from the table.
  async function clear() {
    await highland(store.createQuery(kind).runStream())
      .map((val: any) => {
        return val[store.KEY];
      })
      .batch(500)
      .map(async (keys) => {
        return store.delete(keys);
      })
      .flatMap(highland)
      .collect()
      .toPromise(Promise);
  }
  async function slice(id: string, length: number) {
    const [result] = await store.createQuery(kind).filter("__key__", ">=", makeKey(id)).limit(length).run();
    return result;
  }
  async function between(a: string, b: string) {
    const [result] = await store
      .createQuery(kind)
      .filter("__key__", ">=", makeKey(a))
      .filter("__key__", "<", makeKey(b))
      .run();
    return result;
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
    between,
    slice,
  };
}
