import * as uma from "@uma/sdk";
import { Data, makeId } from "./utils";
const { JsMap } = uma.tables.generic;

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
  return {
    ...table,
    getOrCreate,
    upsert,
  };
};
export type Table = ReturnType<typeof Table>;
