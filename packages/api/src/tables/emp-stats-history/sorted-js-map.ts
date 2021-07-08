import * as uma from "@uma/sdk";
import { Data, makeId, makeEndId } from "./utils";
const { SortedJsMap } = uma.tables.generic;

export const Table = (type = "Emp Stat History") => {
  const table = SortedJsMap<string, Data>(type, makeId);

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

  return {
    ...table,
    getAllByAddress,
    hasByAddress,
    betweenByAddress,
    sliceByAddress,
  };
};
export type Table = ReturnType<typeof Table>;
