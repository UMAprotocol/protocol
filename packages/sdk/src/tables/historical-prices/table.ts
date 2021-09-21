import { Data, makeId } from "./utils";
import BaseTable from "../base";
import { SortedJsMap } from "../../stores";
import type { SortedStore } from "../../stores";

export const Table = (type = "Historical Price", store: SortedStore<string, Data> = SortedJsMap()) => {
  const table = BaseTable<string, Data, SortedStore<string, Data>>({ type, makeId }, store);
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
