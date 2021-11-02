import * as uma from "@uma/sdk";
import { Data, makeId } from "./utils";

const BaseTable = uma.tables.base;
const { JsMap } = uma.stores;

export const Table = (type = "Total Value", store = JsMap<number, Data>()) => {
  const table = BaseTable<number, Data, uma.stores.Store<number, Data>>({ type, makeId }, store);

  async function set(value: string, timestamp: number) {
    await store.set(1, {
      id: 1,
      value,
      timestamp,
    });
  }

  async function get() {
    return store.get(1);
  }

  return {
    ...table,
    set,
    get,
  };
};

export type Table = ReturnType<typeof Table>;
