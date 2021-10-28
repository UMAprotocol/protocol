import { Data, makeId } from "./utils";
import BaseTable from "../base";
import { JsMap } from "../../stores";
import type { Store } from "../../stores";

export const Table = (type = "Token", store: Store<string, Data> = JsMap()) => {
  const table = BaseTable<string, Data, Store<string, Data>>({ type, makeId }, store);
  async function getOrCreate(address: string) {
    if (!(await table.has(makeId({ address })))) return table.create({ address });
    return table.get(makeId({ address }));
  }
  async function upsert(address: string, data: Partial<Data>) {
    await getOrCreate(address);
    return table.update(address, data);
  }
  return {
    ...table,
    getOrCreate,
    upsert,
  };
};
export type Table = ReturnType<typeof Table>;
