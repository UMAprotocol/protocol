import assert from "assert";
import { exists } from "../../utils";
import type { stores, MakeId, MaybeId, HasId } from "../..";

// This interface has to be implemented manually in order to have control over the types of the "overloaded" functions
interface KnownReturnMembers<I, D> {
  create: (data: D & MaybeId<I>) => Promise<D & HasId<I>>;
  set: (data: D & HasId<I>) => Promise<D & HasId<I>>;
  get: (id: I) => Promise<D & { id: I }>;
  has: (id: I) => Promise<boolean>;
  update: (id: I, data: Partial<D>) => Promise<D & HasId<I>>;
}

// The final type composes the types defined explicitly and those from the implemented interface
type TableReturnType<I, D, S> = KnownReturnMembers<I, D> & Omit<S, keyof KnownReturnMembers<I, D>>;

export default function Table<I, D, S extends stores.Store<I, D>>(
  config: { makeId: MakeId<I, D>; type: string },
  store: S
): TableReturnType<I, D, S> {
  const { makeId, type } = config;
  async function create(data: D & MaybeId<I>) {
    const id = exists(data.id) ? data.id : makeId(data);
    assert(!(await has(id)), `${type} exists: ` + id);
    return set({ id, ...data });
  }
  async function set(data: D & HasId<I>) {
    await store.set(data.id, { ...data });
    return data;
  }
  async function get(id: I) {
    assert(await store.has(id), `${type} does not exist`);
    return ((await store.get(id)) as unknown) as D & { id: I };
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
