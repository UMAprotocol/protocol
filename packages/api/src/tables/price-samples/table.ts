import * as uma from "@uma/sdk";
import { Data, makeId } from "./utils";

const BaseTable = uma.tables.base;
const { JsMap } = uma.stores;

export const Table = (type = "Price Samples", store = JsMap<string, Data>()) => {
  const table = BaseTable<string, Data, uma.stores.Store<string, Data>>({ type, makeId }, store);

  return {
    ...table,
  };
};

export type Table = ReturnType<typeof Table>;
