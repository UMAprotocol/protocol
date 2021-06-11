import * as uma from "@uma/sdk";
import { Data, makeId } from "./utils";
const { SortedJsMap } = uma.tables.generic;

export const Table = (type = "Emp Stat History") => {
  const table = SortedJsMap<number, Data>(type, makeId);
  return table;
};
export type Table = ReturnType<typeof Table>;
