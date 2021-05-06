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
