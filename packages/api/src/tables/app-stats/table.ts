import * as uma from "@uma/sdk";
import { Data, makeId } from "./utils";

const BaseTable = uma.tables.base;
const { JsMap } = uma.stores;

export const Table = (type = "App Stats", store = JsMap<number, Data>()) => {
  const table = BaseTable<number, Data, uma.stores.Store<number, Data>>({ type, makeId }, store);

  async function setLastBlockUpdate(lastBlockUpdate: number) {
    return table.set({
      id: 1,
      lastBlockUpdate,
    });
  }

  async function getLastBlockUpdate() {
    try {
      return (await table.get(1)).lastBlockUpdate;
    } catch {
      return undefined;
    }
  }

  return {
    ...table,
    setLastBlockUpdate,
    getLastBlockUpdate,
  };
};

export type Table = ReturnType<typeof Table>;
