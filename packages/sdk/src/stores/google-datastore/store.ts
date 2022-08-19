import { exists } from "../../utils";
import type { SortedStore } from "..";
import { Datastore, Key } from "@google-cloud/datastore";
import highland from "highland";

//-
// Use an array, `excludeFromIndexes`, to exclude properties from indexing.
// This will allow storing string values larger than 1500 bytes.
// Example:
// [
//   'description',
//   'embeddedEntity.description',
//   'arrayValue[]',
//   'arrayValue[].description'
// ]
//-
export default function <I extends string | number, D>(
  kind: string,
  store: Datastore,
  excludeFromIndexes: string[] = []
): SortedStore<I, D> {
  function makeKey(id: I): Key {
    return store.key([kind, id]);
  }
  // return value or undefined if it doesnt exist
  async function get(id: I) {
    try {
      const [result] = await store.get(makeKey(id));
      return result;
    } catch (err) {
      return;
    }
  }
  async function set(id: I, data: D) {
    await store.save({
      key: makeKey(id),
      data,
      excludeFromIndexes,
    });
  }
  async function has(id: I) {
    // horribly ineficient to actually query data to see if it exists, but cannot find a better way
    return exists(await get(id));
  }
  async function del(id: I) {
    await store.delete(makeKey(id));
  }
  async function entries() {
    const [results] = await store.createQuery(kind).run();
    return results.map((result) => {
      return [result[store.KEY].name, result];
    }) as [I, D][];
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
    }) as I[];
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
  async function slice(id: I, length: number) {
    const [result] = await store.createQuery(kind).filter("__key__", ">=", makeKey(id)).limit(length).run();
    return result;
  }
  async function between(a: I, b: I) {
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
