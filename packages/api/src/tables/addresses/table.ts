import * as uma from "@uma/sdk";
import { Data, makeId } from "./utils";

const BaseTable = uma.tables.base;
const { JsMap } = uma.stores;

export const Table = (type = "Addresses", store = JsMap<string, Data>()) => {
  const table = BaseTable<string, Data, uma.stores.Store<string, Data>>({ type, makeId }, store);

  async function set(address: string) {
    await store.set(address, { id: address, address });
  }

  return {
    ...table,
    set,
  };
};

export type Table = ReturnType<typeof Table>;
