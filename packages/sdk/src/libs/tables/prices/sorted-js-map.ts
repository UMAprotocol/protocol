import { Data, makeId } from ".";
import { SortedJsMap } from "../generic";

export const Table = (type = "Price") => {
  return SortedJsMap<string, Data>(type, makeId);
};
export type Table = ReturnType<typeof Table>;
