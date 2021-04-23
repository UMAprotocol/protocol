import assert from "assert";
import { exists } from "./utils";
import { ethers } from "ethers";

type CacheType = {
  [key: string]: string | number | boolean;
};
export const Cache = (table = new Map<string | number, CacheType>()) => {
  function list() {
    return [...table.values()];
  }
  return {
    has: table.has.bind(table),
    set: table.set.bind(table),
    get: table.get.bind(table),
    delete: table.delete.bind(table),
    list
  };
};
type NftPosition = {
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
export const NftPositions = (config: any, table: ReturnType<typeof Cache>) => {
  function makeId(data: NftPosition) {
    return data.tokenId;
  }
  async function create(data: NftPosition) {
    const id = makeId(data);
    assert(!(await has(id)), "Position exists");
    return set({ id, ...data });
  }
  async function set(data: NftPosition) {
    assert(data.id, "Position requires id");
    await table.set(data.id, { ...data });
    return data;
  }
  async function get(id: string) {
    assert(await table.has(id), "Position does not exist");
    return table.get(id);
  }
  async function has(id: string) {
    return table.has(id);
  }
  async function forEach(cb: (value: NftPosition, index: number, array: NftPosition[]) => void) {
    const list: NftPosition[] = (await table.list()) as NftPosition[];
    list.forEach(cb);
  }
  async function update(id: string, data: any = {}) {
    const position = await get(id);
    return set({ ...position, ...data });
  }

  return {
    create,
    set,
    get,
    has,
    update,
    forEach,
    list: table.list
  };
};
type Position = {
  id?: string;
  operator: string;
  tickLower: string;
  tickUpper: string;
  nonce?: string;
  token0?: string;
  token1?: string;
  liquidity?: string;
  feeGrowthInside0LastX128?: string;
  feeGrowthInside1LastX128?: string;
  tokensOwed0?: string;
  tokensOwed1?: string;
  pool?: string;
};

// These positions are from core pool contracts and are indexed using hash of upper/lower/user address.
export const Positions = (config: any, table: ReturnType<typeof Cache>) => {
  function makeId(data: Position) {
    const encoded = ethers.utils.defaultAbiCoder.encode(
      [
        ethers.utils.ParamType.from({
          indexed: true,
          name: "owner",
          type: "address"
        }),
        ethers.utils.ParamType.from({
          indexed: true,
          baseType: "int24",
          name: "tickLower",
          type: "int24"
        }),
        ethers.utils.ParamType.from({
          indexed: true,
          baseType: "int24",
          name: "tickUpper",
          type: "int24"
        })
      ],
      [data.operator, data.tickLower, data.tickUpper]
    );
    // this is how positions are indexed in the v3 core contract
    return ethers.utils.keccak256(encoded);
  }
  async function create(data: Position) {
    const id = makeId(data);
    assert(!(await has(id)), "Position exists");
    return set({ id, ...data });
  }
  async function set(data: Position) {
    assert(data.id, "Position requires id");
    await table.set(data.id, { ...data });
    return data;
  }
  async function get(id: string) {
    assert(await table.has(id), "Position does not exist");
    return table.get(id);
  }
  async function has(id: string) {
    return table.has(id);
  }
  async function forEach(cb: (value: Position, index: number, array: Position[]) => void) {
    const list: Position[] = (await table.list()) as Position[];
    list.forEach(cb);
  }
  async function update(id: string, data: any = {}) {
    const position = await get(id);
    return set({ ...position, ...data });
  }

  return {
    create,
    set,
    get,
    has,
    update,
    forEach,
    list: table.list
  };
};

type GlobalState = {
  id?: string;
  token0: string;
  token1: string;
  fee: string;
  sqrtPriceX96?: string;
  tick?: number;
  liquidity?: string;
  feeProtocol?: number;
  feeGrowthGlobal0X128?: string;
  feeGrowthGlobal1X128?: string;
  protocolFeesToken0?: string;
  protocolFeesToken1?: string;
  address?: string;
};
// pool id is tokenA, tokenB, fee
export const Pools = (config: any, table: ReturnType<typeof Cache>) => {
  function makeId(state: GlobalState) {
    const { token0, token1, fee } = state;
    if (token0 < token1) {
      return [token0, token1, fee].join("!");
    }
    return [token1, token0, fee].join("!");
  }
  async function create(state: GlobalState) {
    const id = makeId(state);
    assert(!(await has(id)), "State already exists:" + id);
    return set({ id, ...state });
  }
  async function set(state: GlobalState) {
    assert(state.id, "requires id");
    await table.set(state.id, state);
    return state;
  }
  async function get(id: string) {
    assert(await has(id), "No such pool state");
    return table.get(id);
  }
  async function has(id: string) {
    return table.has(id);
  }
  async function update(id: string, data: any = {}) {
    const pool = await get(id);
    return set({ ...pool, ...data });
  }
  async function list() {
    return table.list();
  }
  return {
    create,
    set,
    get,
    has,
    update,
    list
  };
};

type TickInfo = {
  //     // the total position liquidity that references this tick
  liquidityGross?: string;
  //     // amount of net liquidity added (subtracted) when tick is crossed from left to right (right to left),
  liquidityNet?: string;
  //     // fee growth per unit of liquidity on the _other_ side of this tick (relative to the current tick)
  //     // only has relative meaning, not absolute — the value depends on when the tick is initialized
  feeGrowthOutside0X128?: string;
  feeGrowthOutside1X128?: string;
  //     // the cumulative tick value on the other side of the tick
  tickCumulativeOutside?: string;
  //     // the seconds per unit of liquidity on the _other_ side of this tick (relative to the current tick)
  //     // only has relative meaning, not absolute — the value depends on when the tick is initialized
  secondsPerLiquidityOutsideX128?: string;
  //     // the seconds spent on the other side of the tick (relative to the current tick)
  //     // only has relative meaning, not absolute — the value depends on when the tick is initialized
  secondsOutside?: string;
  //     // true iff the tick is initialized, i.e. the value is exactly equivalent to the expression liquidityGross != 0
  //     // these 8 bits are set to prevent fresh sstores when crossing newly initialized ticks
  initialized?: boolean;
  pool?: string;
  index?: string;
  id?: string;
};
export const Ticks = (config: any, table: ReturnType<typeof Cache>) => {
  function makeId(state: TickInfo) {
    const { pool, index } = state;
    return [pool, index].join("!");
  }
  async function create(state: TickInfo) {
    const id = makeId(state);
    assert(!(await has(id)), "tick already exists:" + id);
    return set({ id, ...state });
  }
  async function set(state: TickInfo) {
    assert(state.id, "requires id");
    await table.set(state.id, state);
    return state;
  }
  async function get(id: string) {
    assert(await has(id), "No such tick state");
    return table.get(id);
  }
  async function has(id: string) {
    return table.has(id);
  }
  async function update(id: string, data: any = {}) {
    const got = await get(id);
    return set({ ...got, ...data });
  }
  async function list() {
    return table.list();
  }
  return {
    create,
    set,
    get,
    has,
    update,
    list
  };
};
