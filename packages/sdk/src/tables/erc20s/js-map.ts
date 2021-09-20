import { Data, makeId } from "./utils";
import JsMap from "../base";
import { Store } from "../../stores";

export const Table = (type = "Token", store: Store<string, Data>) => {
  const table = JsMap<string, Data, Store<string, Data>>({ type, makeId }, store);
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
