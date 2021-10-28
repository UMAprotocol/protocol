import * as uma from "@uma/sdk";
import { Data, makeId, makeEndId } from "./utils";
const BaseTable = uma.tables.base;
const { SortedJsMap } = uma.stores;
const globalId = "global";

export const Table = (type = "Emp Stat History", store = SortedJsMap<string, Data>()) => {
  const table = BaseTable<string, Data, uma.stores.SortedStore<string, Data>>({ type, makeId }, store);

  function hasByAddress(address: string, timestamp: number) {
    return table.has(makeId({ address, timestamp }));
  }
  function getAllByAddress(address: string) {
    const startid = makeId({ address, timestamp: 0 });
    const endid = makeEndId({ address });
    return table.between(startid, endid);
  }
  function betweenByAddress(address: string, start: number, end: number) {
    const startid = makeId({ address, timestamp: start });
    const endid = makeId({ address, timestamp: end });
    return table.between(startid, endid);
  }
  async function sliceByAddress(address: string, start: number, length: number) {
    const startid = makeId({ address, timestamp: start });
    const endid = makeEndId({ address });
    const result = await table.between(startid, endid);
    return result.slice(0, length);
  }

  function hasGlobal(timestamp: number) {
    return hasByAddress(globalId, timestamp);
  }
  function getAllGlobal() {
    return getAllByAddress(globalId);
  }
  function betweenByGlobal(start: number, end: number) {
    return betweenByAddress(globalId, start, end);
  }
  function sliceByGlobal(start: number, length: number) {
    return sliceByAddress(globalId, start, length);
  }
  function createGlobal(data: { timestamp: number; value: string }) {
    return table.create({ ...data, address: globalId });
  }

  return {
    ...table,
    getAllByAddress,
    hasByAddress,
    betweenByAddress,
    sliceByAddress,
    hasGlobal,
    getAllGlobal,
    betweenByGlobal,
    sliceByGlobal,
    createGlobal,
  };
};
export type Table = ReturnType<typeof Table>;
