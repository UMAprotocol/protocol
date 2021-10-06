import * as uma from "@uma/sdk";
import { Data, makeId } from "./utils";
const Base = uma.tables.base;
const { JsMap } = uma.stores;

export const Table = (type = "LSP", store = JsMap<string, Data>()) => {
  const table = Base<string, Data, uma.stores.Store<string, Data>>({ type, makeId }, store);

  async function addSponsors(id: string, sponsors: string[]) {
    const data = await table.get(id);
    // keep sponsors unique
    const set = new Set([...(data.sponsors || []), ...sponsors]);
    return table.update(id, { sponsors: Array.from(set.values()) });
  }

  async function setCreatedTimestamp(id: string, timestamp: number) {
    return table.update(id, { createdTimestamp: timestamp });
  }

  return {
    ...table,
    addSponsors,
    setCreatedTimestamp,
  };
};
// want to export the type as the same name
export type Table = ReturnType<typeof Table>;
