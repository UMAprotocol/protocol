import * as uma from "@uma/sdk";
import { Data, makeId } from "./utils";
const { JsMap } = uma.tables.generic;

const globalId = "global";
export const Table = (type = "Emp Stat") => {
  const table = JsMap<string, Data>(type, makeId);
  async function getOrCreate(address: string) {
    if (await table.has(makeId({ address }))) return table.get(makeId({ address }));
    return table.create({ address });
  }
  async function upsert(address: string, data: Partial<Data>) {
    await getOrCreate(address);
    return table.update(address, data);
  }
  async function upsertGlobal(data: Partial<Data>) {
    return upsert(globalId, data);
  }
  async function getGlobal() {
    return table.get(globalId);
  }
  async function getOrCreateGlobal() {
    return getOrCreate(globalId);
  }
  return {
    ...table,
    getOrCreate,
    upsert,
    upsertGlobal,
    getOrCreateGlobal,
    getGlobal,
  };
};
export type Table = ReturnType<typeof Table>;
