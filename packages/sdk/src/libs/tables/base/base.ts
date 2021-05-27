import assert from "assert";
import { exists } from "../../utils";
import type { stores, MakeId, MaybeId, HasId } from "../..";

export default function Table<I, D>(config: { makeId: MakeId<I, D>; type: string }, store: stores.Store<I, D>) {
  const { makeId, type } = config;
  async function create(data: D & MaybeId<I>) {
    const id = exists(data.id) ? data.id : makeId(data);
    assert(!(await has(id)), `${type} exists`);
    return set({ id, ...data });
  }
  async function set(data: D & HasId<I>) {
    await store.set(data.id, { ...data });
    return data;
  }
  async function get(id: I) {
    assert(await store.has(id), `${type} does not exist`);
    return (await store.get(id)) as D & { id: I };
  }
  async function has(id: I) {
    return store.has(id);
  }
  async function update(id: I, data: Partial<D>) {
    const got = await get(id);
    return set({ ...got, ...data });
  }
  return {
    ...store,
    create,
    set,
    get,
    has,
    update,
    makeId,
    type,
  };
}
