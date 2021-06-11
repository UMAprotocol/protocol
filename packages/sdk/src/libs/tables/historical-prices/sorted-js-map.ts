import { Data, makeId } from "./utils";
import { SortedJsMap } from "../generic";

export const Table = (type = "Historical Price") => {
  return SortedJsMap<string, Data>(type, makeId);
};
export type Table = ReturnType<typeof Table>;
