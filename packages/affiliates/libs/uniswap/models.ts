import assert from "assert";
import { exists, getPositionKey } from "./utils";

type Id = string;
interface MaybeId {
  id?: Id;
}
interface MakeId<T> {
  (obj: T): Id;
}
// Generic table with common functions, store is a map now, but we could replace this with any kind of
// data store with some minor modifications, as long as it has, set, get, delete, has and values
export function Table<T extends MaybeId>(config: { makeId: MakeId<T>; type: Id }, store: Map<Id, T>) {
  const { makeId, type } = config;
  async function create(data: T) {
    const id = exists(data.id) ? data.id : makeId(data);
    assert(!(await has(id)), `${type} exists`);
    return set({ id, ...data });
  }
  async function set(data: T & { id: Id }) {
    await store.set(data.id, { ...data });
    return data;
  }
  async function get(id: Id) {
    assert(await store.has(id), `${type} does not exist`);
    return (await store.get(id)) as T & { id: Id };
  }
  async function has(id: Id) {
    return store.has(id);
  }
  async function list() {
    return [...store.values()];
  }
  async function forEach(cb: (value: T, index: number, array: T[]) => void) {
    const all = await list();
    all.forEach(cb);
  }
  async function update(id: Id, data: Partial<T>) {
    const got = await get(id);
    return set({ ...got, ...data });
  }
  async function entries() {
    return [...store.entries()];
  }
  return {
    create,
    set,
    get,
    has,
    update,
    forEach,
    list,
    store,
    entries,
  };
}

export type Position = {
  id?: string;
  operator: string;
  tickLower: string;
  tickUpper: string;
  token0?: string;
  token1?: string;
  liquidity?: string;
  feeGrowthInside0LastX128?: string;
  feeGrowthInside1LastX128?: string;
  tokensOwed0?: string;
  tokensOwed1?: string;
  pool?: string;
  blockCreated?: number;
};

// These positions are from core pool contracts and are indexed using hash of upper/lower/user address.
export const Positions = () => {
  function makeId(data: Position) {
    return getPositionKey(data.operator, data.tickLower, data.tickUpper);
  }
  const store = new Map<Id, Position>();
  const table = Table<Position>({ makeId, type: "Positions" }, store);

  async function lteBlockNumber(blockNumber: number | string | undefined) {
    if (blockNumber === undefined) return table.list();
    if (blockNumber === "latest") return table.list();
    return [...store.values()].filter((position) => {
      return Number(position.blockCreated) <= blockNumber;
    });
  }
  return {
    ...table,
    lteBlockNumber,
  };
};
export type Positions = ReturnType<typeof Positions>;

export type Pool = {
  id?: string;
  token0?: string;
  token1?: string;
  fee?: string;
  sqrtPriceX96?: string;
  tick?: number;
  liquidity?: string;
  feeProtocol?: number;
  feeGrowthGlobal0X128?: string;
  feeGrowthGlobal1X128?: string;
  protocolFeesToken0?: string;
  protocolFeesToken1?: string;
  address: string;
};
// pool id is tokenA, tokenB, fee
export const Pools = () => {
  function makeId(state: Pool) {
    return state.address;
  }
  const store = new Map<Id, Pool>();
  return Table<Pool>({ makeId, type: "Pool" }, store);
};
export type Pools = ReturnType<typeof Pools>;

export const Balances = () => {
  let total = 0n;
  const store = new Map<Id, string>();
  function getOrCreate(address: string) {
    if (store.has(address)) return store.get(address);
    return create(address);
  }
  function create(addr: string) {
    assert(!store.has(addr), "Already has address");
    store.set(addr, "0");
    return "0";
  }
  function add(addr: string, amount: string) {
    const amountn = BigInt(amount);
    assert(amountn >= 0n, "amount must be >= 0: " + amount);
    const balance = getOrCreate(addr);
    const result = (BigInt(balance) + amountn).toString();
    store.set(addr, result);
    total = total + amountn;
    return result;
  }
  function sub(addr: string, amount: string) {
    const amountn = BigInt(amount);
    assert(amountn >= 0n, "amount must be >= 0: " + amount);
    const balance = getOrCreate(addr);
    const result = (BigInt(balance) - amountn).toString();
    store.set(addr, result);
    total = total - amountn;
    return result;
  }
  function snapshot() {
    return Object.fromEntries(store.entries());
  }
  function getTotal() {
    return total.toString();
  }
  return {
    ...store,
    sub,
    add,
    create,
    getOrCreate,
    snapshot,
    getTotal,
  };
};
export type Balances = ReturnType<typeof Balances>;
