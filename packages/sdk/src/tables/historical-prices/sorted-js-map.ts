import { Data, makeId } from "./utils";
import { SortedJsMap } from "../generic";

export const Table = (type = "Historical Price") => {
  const table = SortedJsMap<string, Data>(type, makeId);
  function betweenByTimestamp(a: number, b: number) {
    return table.between(makeId({ timestamp: a }), makeId({ timestamp: b }));
  }
  function sliceByTimestamp(timestamp: number, length: number) {
    return table.slice(makeId({ timestamp }), length);
  }
  function hasByTimestamp(timestamp: number) {
    return table.has(makeId({ timestamp }));
  }
  function getByTimestamp(timestamp: number) {
    return table.get(makeId({ timestamp }));
  }
  return {
    ...table,
    betweenByTimestamp,
    sliceByTimestamp,
    hasByTimestamp,
    getByTimestamp,
  };
};
export type Table = ReturnType<typeof Table>;
