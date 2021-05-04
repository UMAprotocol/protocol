import assert from "assert";
import lodash from "lodash";
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
  function entries() {
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
    store
  };
}

export type NftPosition = {
  id?: string;
  tokenId: string;
  amount?: string;
  amount0?: string;
  amount1?: string;
  token0?: string;
  token1?: string;
  liquidity?: string;
  feeGrowthInside0LastX128?: string;
  feeGrowthInside1LastX128?: string;
  tokensOwed0?: string;
  tokensOwed1?: string;
  pool?: string;
};

// Nft positions are gathered from the nft contract, and require slightly different indexing than the positions in pool contract
export const NftPositions = () => {
  function makeId(data: NftPosition) {
    return data.tokenId;
  }
  const store = new Map<Id, NftPosition>();
  return Table<NftPosition>({ makeId, type: "NftPositions" }, store);
};
export type NftPositions = ReturnType<typeof NftPositions>;

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
    return [...store.values()].filter(position => {
      return Number(position.blockCreated) <= blockNumber;
    });
  }
  return {
    ...table,
    lteBlockNumber
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

export type Tick = {
  // the total position liquidity that references this tick
  liquidityGross?: string;
  // amount of net liquidity added (subtracted) when tick is crossed from left to right (right to left),
  liquidityNet?: string;
  // fee growth per unit of liquidity on the _other_ side of this tick (relative to the current tick)
  // only has relative meaning, not absolute — the value depends on when the tick is initialized
  feeGrowthOutside0X128?: string;
  feeGrowthOutside1X128?: string;
  // the cumulative tick value on the other side of the tick
  tickCumulativeOutside?: string;
  // the seconds per unit of liquidity on the _other_ side of this tick (relative to the current tick)
  // only has relative meaning, not absolute — the value depends on when the tick is initialized
  secondsPerLiquidityOutsideX128?: string;
  // the seconds spent on the other side of the tick (relative to the current tick)
  // only has relative meaning, not absolute — the value depends on when the tick is initialized
  secondsOutside?: string;
  // true iff the tick is initialized, i.e. the value is exactly equivalent to the expression liquidityGross != 0
  // these 8 bits are set to prevent fresh sstores when crossing newly initialized ticks
  initialized?: boolean;
  pool?: string;
  index?: string;
  id?: string;
};
export const Ticks = () => {
  function makeId(state: Tick) {
    const { pool, index } = state;
    return [pool, index].join("!");
  }
  const store = new Map<Id, Tick>();
  return Table<Tick>({ makeId, type: "Ticks" }, store);
};
export type Ticks = ReturnType<typeof Ticks>;

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
  function getPercent(address: string, scale = 10n ** 18n) {
    const balance = getOrCreate(address);
    return ((BigInt(balance) * scale) / total).toString();
  }
  return {
    ...store,
    sub,
    add,
    create,
    getOrCreate,
    snapshot,
    getTotal,
    getPercent
  };
};
export type Balances = ReturnType<typeof Balances>;

export function SortedMap<T>() {
  const ids: Id[] = [];
  const map = new Map<Id, T>();

  function getStart(id: Id, inclusive = true) {
    if (inclusive) {
      return lodash.sortedIndex(ids, id);
    } else {
      return lodash.sortedLastIndex(ids, id);
    }
  }
  function getEnd(id: Id, inclusive = false) {
    return getStart(id, !inclusive);
  }
  function del(id: Id) {
    const index = lodash.sortedIndex(ids, id);
    ids.splice(index, 1);
    const result = map.get(id);
    map.delete(id);
    return result;
  }
  return {
    has(id: Id) {
      return map.has(id);
    },
    set(id: Id, data: T) {
      if (map.has(id)) {
        map.set(id, data);
        return data;
      }
      const index = lodash.sortedIndex(ids, id);
      ids.splice(index, 0, id);
      map.set(id, data);
      return data;
    },
    get(id: Id) {
      return map.get(id);
    },
    values() {
      return ids.map(id => map.get(id));
    },
    entries() {
      return ids.map(id => [id, map.get(id)]);
    },
    keys() {
      return [...ids];
    },
    clear() {
      map.clear();
      ids.length = 0;
    },
    size() {
      return ids.length;
    },
    delete: del,
    between(a: Id, b: Id, includeA = true, includeB = false) {
      const start = getStart(a, includeA);
      const end = getEnd(b, includeB);
      return ids.slice(start, end).map(id => map.get(id));
    },
    slice(id: Id, length: number, inclusive: boolean) {
      const start = getStart(id, inclusive);
      return ids.slice(start, start + length).map(id => map.get(id));
    }
  };
}

interface TimeSample {
  id?: Id;
  timestamp: number;
}
//   const history = T[];
//   const indexName = 'index'
//   // Used internally, but will insert a block into cache sorted by timestamp ascending
//   function insert(data:T) {
//     const index = lodash.sortedIndexBy(history, data, indexName);
//     history.splice(index, 0, data);
//     return data;
//   }
//   function lookup(index:Index) {
//     const index = lodash.sortedIndexBy(history, { [indexName]:index }, indexName);
//     assert(history.length, "history is empty");
//     if (history[index] && history[index][indexName] === index) return history[index];
//     const result = history[index - 1];
//     assert(
//       result,
//       `history does not go back far enough: looked up ${blockNumber} vs earliest ${history[0].blockNumber}`
//     );
//     return result;
//   }
//   // // get exact block number
//   function get(index) {
//     const result = history.find(x => x.blockNumber == blockNumber);
//     assert(result, "Not found in history: " + blockNumber);
//     return result;
//   }
//   // function has(blockNumber) {
//   //   return !!history.find(x => x.blockNumber == blockNumber);
//   // }
//   // function length() {
//   //   return history.length;
//   // }
//   // return {
//   //   get,
//   //   has,
//   //   insert,
//   //   lookup,
//   //   history,
//   //   length
//   // };
// }
// export type TimeSeries = ReturnType<typeof TimeSeries>;
